import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { XenitionError } from '../core/errors';
import type { QuotaState } from '../modules/quotas';
import { honoErrorHandler, paymentRequired, paymentRequiredBody } from './errors';
import type { PaymentRequiredOptions } from './errors';

/**
 * The two things a client cannot recover from on its own: an error it
 * cannot parse, and two shapes for one condition.
 *
 * Every route below throws rather than returning, because that is the path
 * that was broken — `app.onError` is where an app's own refusals land, and
 * an unrecognised throw there becomes a 500 that says nothing.
 */
const appThatThrows = (thrown: unknown) => {
  const app = new Hono();
  app.onError(honoErrorHandler);
  app.get('/x', () => {
    throw thrown;
  });
  return app;
};

const errorOf = async (res: Response) =>
  (await res.json()) as { error: { code: string; message: string } };

describe('honoErrorHandler: Hono’s own HTTPException', () => {
  it('maps a thrown HTTPException to the SDK’s JSON error body', async () => {
    // Before this branch existed the idiomatic Hono refusal fell through
    // every case and became 500 INTERNAL — every validation error and every
    // ownership check in an app answering "internal error".
    const res = await appThatThrows(
      new HTTPException(404, { message: 'No such pantry.' }),
    ).request('/x');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await errorOf(res)).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such pantry.' },
    });
  });

  it('answers JSON for a bare HTTPException rather than Hono’s text/plain', async () => {
    // `new HTTPException(400)` carries no message at all. Hono's own
    // response for it is prose; one client parser cannot read both that and
    // the JSON every other error here uses.
    const res = await appThatThrows(new HTTPException(400)).request('/x');

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await errorOf(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).not.toBe('');
  });

  it('maps each refusal status to the code the SDK’s own helpers emit', async () => {
    const expected: Array<[ContentfulStatusCode, string]> = [
      [400, 'VALIDATION_ERROR'],
      [401, 'UNAUTHORIZED'],
      [402, 'PAYMENT_REQUIRED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT'],
    ];
    for (const [status, code] of expected) {
      const res = await appThatThrows(new HTTPException(status, { message: 'no' })).request('/x');
      expect([status, (await errorOf(res)).error.code]).toEqual([status, code]);
    }
  });

  it('falls back to ERROR for a status with no dedicated code', async () => {
    const res = await appThatThrows(new HTTPException(410, { message: 'Gone.' })).request('/x');
    expect(res.status).toBe(410);
    expect((await errorOf(res)).error.code).toBe('ERROR');
  });

  it('passes an HTTPException that carries its own Response through untouched', async () => {
    // This is how a caller attaches a typed body — the paywall's 402 is
    // built exactly this way. Rebuilding it would throw the payload away.
    const paywall = Response.json(paymentRequiredBody({ entitlement: 'premium' }), {
      status: 402,
    });
    const res = await appThatThrows(new HTTPException(402, { res: paywall })).request('/x');

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: 'PAYMENT_REQUIRED' },
      entitlement: 'premium',
    });
  });

  it('keeps a 5xx HTTPException body generic and scrubs 4xx messages', async () => {
    // The rule the rest of this file follows: a route's own text is as able
    // to name an upstream host as a module client's is.
    const internal = await appThatThrows(
      new HTTPException(500, { message: 'postgres://user:pw@host' }),
    ).request('/x');
    expect(internal.status).toBe(500);
    const internalBody = await errorOf(internal);
    expect(internalBody.error.code).toBe('INTERNAL');
    expect(internalBody.error.message).not.toContain('postgres://');

    const client = await appThatThrows(
      new HTTPException(400, { message: 'bad callback https://internal.example/cb' }),
    ).request('/x');
    expect((await errorOf(client)).error.message).not.toContain('https://internal.example');
  });

  it('still maps the errors it always did', async () => {
    // The new branch runs first, so this is the regression guard: nothing
    // below it changed behaviour.
    const upstream = await appThatThrows(
      new XenitionError('NOT_FOUND', 'unknown form "contact"'),
    ).request('/x');
    expect(upstream.status).toBe(404);
    expect((await errorOf(upstream)).error.code).toBe('NOT_FOUND');

    const validation = await appThatThrows(
      new Error('FormsClient.submit: "email" is required'),
    ).request('/x');
    expect(validation.status).toBe(400);
    expect((await errorOf(validation)).error.code).toBe('VALIDATION_ERROR');

    const bug = await appThatThrows(new Error('secret postgres://user:pw@host')).request('/x');
    expect(bug.status).toBe(500);
    expect(await bug.text()).not.toContain('postgres://');
  });
});

  it('recognises an HTTPException from a DIFFERENT copy of hono', async () => {
    // The dual-package hazard, as a test. The SDK is published CJS and a
    // modern Hono app is ESM, so `require('hono/http-exception')` and
    // `import 'hono/http-exception'` hand back two different classes. An
    // exception thrown by the app then fails `instanceof` against the class
    // this file imported, and used to fall through to a generic 500 — the
    // exact failure this branch exists to prevent.
    //
    // A structurally identical impostor stands in for the other copy.
    class ForeignHTTPException extends Error {
      constructor(readonly status: number, message: string) {
        super(message);
      }
      getResponse(): Response {
        return new Response(this.message, { status: this.status });
      }
    }

    const app = new Hono();
    app.onError(honoErrorHandler);
    app.get('/x', () => {
      throw new ForeignHTTPException(404, 'No such thing.');
    });

    const res = await app.request('/x');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No such thing.' } });
  });

describe('the one payment-required body', () => {
  /**
   * Exactly what `quotas.consume()` returns — annotated as `QuotaState` on
   * purpose, so this stops compiling if the two ever drift apart. An app
   * spreading its quota state into the helper is the whole point: nobody
   * should be hand-rolling a 402 body next to a metered call.
   */
  const spent: QuotaState = {
    allowed: false,
    used: 5,
    limit: 5,
    remaining: 0,
    period: 'month',
    resetAt: '2026-09-01T00:00:00.000Z',
  };

  const respond = (options: PaymentRequiredOptions) => {
    const app = new Hono();
    app.get('/x', (c) => paymentRequired(c, options));
    return app.request('/x');
  };

  it('is the same shape whether an entitlement or a quota refused', async () => {
    // The bug: "you must upgrade" and "you are out of runs" answered two
    // different bodies, so the app's paywall depended on which SDK feature
    // said no.
    const gate = paymentRequiredBody({ entitlement: 'premium' });
    const meter = paymentRequiredBody({
      entitlement: 'premium',
      quota: { key: 'analysis', ...spent },
    });

    expect(gate.error.code).toBe('PAYMENT_REQUIRED');
    expect(meter.error.code).toBe('PAYMENT_REQUIRED');
    expect(gate.entitlement).toBe('premium');
    expect(meter.entitlement).toBe('premium');
    // The presence of `quota` IS the distinction between the two.
    expect(gate.quota).toBeUndefined();
    expect(meter.quota).toEqual({
      key: 'analysis',
      limit: 5,
      used: 5,
      resetAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('drops the quota fields the body does not promise', async () => {
    // `remaining` and `period` are derivable; every extra field is one more
    // thing a client has to be told about.
    const body = paymentRequiredBody({
      entitlement: 'premium',
      quota: { key: 'analysis', ...spent },
    });
    expect(Object.keys(body.quota!).sort()).toEqual(['key', 'limit', 'resetAt', 'used']);
  });

  it('answers 402 with a JSON content-type', async () => {
    const res = await respond({ entitlement: 'premium', quota: { key: 'analysis', ...spent } });
    expect(res.status).toBe(402);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({
      error: { code: 'PAYMENT_REQUIRED' },
      entitlement: 'premium',
      quota: { key: 'analysis', used: 5 },
    });
  });

  it('says which allowance ran out, and takes an override', () => {
    expect(paymentRequiredBody({ entitlement: 'premium', quota: { key: 'analysis', ...spent } })
      .error.message).toContain('analysis');
    expect(paymentRequiredBody({ entitlement: 'premium' }).error.message).toContain('premium');
    expect(
      paymentRequiredBody({ entitlement: 'premium', message: 'Upgrade to keep cooking.' }).error
        .message,
    ).toBe('Upgrade to keep cooking.');
  });
});
