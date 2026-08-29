import axios, { AxiosInstance } from 'axios';
import { CircuitBreakerOptions, HttpClient, isCancelledError } from './http-client';
import { XenitionError } from './errors';
import { XENITION_BASE_URL } from '../constants';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** The `request` fn on the axios instance returned by axios.create(). */
const requestMock = jest.fn();

/** Build a fake AxiosError-shaped rejection (isAxiosError duck-typed). */
const axiosError = (
  status: number | null,
  data?: unknown,
  message = 'Request failed',
) => ({
  isAxiosError: true,
  message,
  response: status === null ? undefined : { status, data },
});

beforeEach(() => {
  requestMock.mockReset();
  mockedAxios.create.mockImplementation(
    (config) =>
      ({
        request: requestMock,
        defaults: { ...config, headers: { common: {} } },
      }) as unknown as AxiosInstance,
  );
  (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
    (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError),
  );
});

const makeClient = (retries = 0) =>
  new HttpClient('xen_service_test', { retries });

const caughtError = async (p: Promise<unknown>): Promise<XenitionError> => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(XenitionError);
    return err as XenitionError;
  }
  throw new Error('expected promise to reject');
};

describe('envelope unwrapping', () => {
  it('unwraps {success: true, data} to the payload', async () => {
    requestMock.mockResolvedValue({
      data: { success: true, data: { id: 'u_1' } },
    });
    await expect(makeClient().get('/x')).resolves.toEqual({ id: 'u_1' });
  });

  it('passes non-envelope bodies through untouched', async () => {
    requestMock.mockResolvedValue({ data: { rows: [1, 2], rowCount: 2 } });
    await expect(makeClient().get('/x')).resolves.toEqual({
      rows: [1, 2],
      rowCount: 2,
    });
  });

  it('throws a typed error on {success: false} with a known code', async () => {
    requestMock.mockResolvedValue({
      data: {
        success: false,
        error: { code: 'QUERY_FAILED', message: 'bad query' },
      },
    });
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('QUERY_FAILED');
    expect(err.message).toBe('bad query');
  });

  it('falls back to UNKNOWN for unrecognized envelope codes, keeping the raw code in details', async () => {
    requestMock.mockResolvedValue({
      data: {
        success: false,
        error: { code: 'SOME_NEW_SERVER_CODE', message: 'novel failure' },
      },
    });
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('novel failure');
    expect(err.details).toEqual({
      code: 'SOME_NEW_SERVER_CODE',
      message: 'novel failure',
    });
  });

  it('handles {success: false} with no error object at all', async () => {
    requestMock.mockResolvedValue({ data: { success: false } });
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('Request failed');
  });
});

describe('error classification (HTTP status → code)', () => {
  const cases: Array<[number | null, string]> = [
    [null, 'NETWORK_ERROR'],
    [400, 'VALIDATION_ERROR'],
    [401, 'AUTH_INVALID_TOKEN'],
    [403, 'AUTH_FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
    [418, 'UNKNOWN'],
  ];

  it.each(cases)('status %p → %s', async (status, expected) => {
    requestMock.mockRejectedValue(axiosError(status));
    const err = await caughtError(makeClient().get('/x'));
    expect(err.code).toBe(expected);
    expect(err.status).toBe(status);
  });

  it('prefers a valid server error.code over the status mapping', async () => {
    requestMock.mockRejectedValue(
      axiosError(401, {
        success: false,
        error: { code: 'AUTH_EXPIRED_TOKEN', message: 'token expired' },
      }),
    );
    const err = await caughtError(makeClient().get('/x'));
    expect(err.code).toBe('AUTH_EXPIRED_TOKEN');
    expect(err.message).toBe('token expired');
  });

  it('ignores unknown server codes and classifies by status, preserving the raw code in details', async () => {
    requestMock.mockRejectedValue(
      axiosError(404, {
        success: false,
        error: { code: 'TEAPOT_EXPLODED', message: 'gone' },
      }),
    );
    const err = await caughtError(makeClient().get('/x'));
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('gone');
    // Nothing lost: the raw server code rides along in details.
    expect(err.details).toEqual({
      success: false,
      error: { code: 'TEAPOT_EXPLODED', message: 'gone' },
    });
  });

  it('wraps non-axios errors as UNKNOWN', async () => {
    requestMock.mockRejectedValue(new Error('something odd'));
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('something odd');
  });

  it('re-throws XenitionErrors untouched', async () => {
    const original = new XenitionError('CONFLICT', 'already exists');
    requestMock.mockRejectedValue(original);
    const err = await caughtError(makeClient().post('/x'));
    expect(err).toBe(original);
  });
});

describe('retry behavior', () => {
  it('retries GETs on transient 5xx and succeeds', async () => {
    requestMock
      .mockRejectedValueOnce(axiosError(500))
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce({ data: { success: true, data: 'ok' } });
    await expect(makeClient(2).get('/x')).resolves.toBe('ok');
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('retries GETs on network errors', async () => {
    requestMock
      .mockRejectedValueOnce(axiosError(null))
      .mockResolvedValueOnce({ data: { success: true, data: 'ok' } });
    await expect(makeClient(1).get('/x')).resolves.toBe('ok');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const err = await caughtError(makeClient(1).get('/x'));
    expect(err.code).toBe('SERVER_ERROR');
    expect(requestMock).toHaveBeenCalledTimes(2); // 1 + 1 retry
  });

  it('does not retry GETs on non-transient errors', async () => {
    requestMock.mockRejectedValue(axiosError(404));
    await caughtError(makeClient(2).get('/x'));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('never retries non-idempotent POSTs, even on 5xx', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const err = await caughtError(makeClient(2).post('/x', { a: 1 }));
    expect(err.code).toBe('SERVER_ERROR');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('never retries DELETEs', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    await caughtError(makeClient(2).del('/x'));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe('verbs and configuration', () => {
  it('routes each verb with the right method and body', async () => {
    requestMock.mockResolvedValue({ data: { success: true, data: null } });
    const client = makeClient();
    await client.get('/g');
    await client.post('/p', { a: 1 });
    await client.patch('/pa', { b: 2 });
    await client.put('/pu', { c: 3 });
    await client.del('/d');

    const calls = requestMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      expect.objectContaining({ method: 'GET', url: '/g' }),
      expect.objectContaining({ method: 'POST', url: '/p', data: { a: 1 } }),
      expect.objectContaining({ method: 'PATCH', url: '/pa', data: { b: 2 } }),
      expect.objectContaining({ method: 'PUT', url: '/pu', data: { c: 3 } }),
      expect.objectContaining({ method: 'DELETE', url: '/d' }),
    ]);
  });

  it('sends the api key header and honors the baseUrl override', () => {
    new HttpClient('xen_service_test', { baseUrl: 'https://example.com/v1' });
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://example.com/v1',
        headers: expect.objectContaining({ 'x-api-key': 'xen_service_test' }),
      }),
    );
  });

  it('exposes the effective baseUrl (override or default)', () => {
    const overridden = new HttpClient('xen_service_test', {
      baseUrl: 'https://example.com/v1',
    });
    expect(overridden.baseUrl).toBe('https://example.com/v1');

    const plain = new HttpClient('xen_service_test');
    expect(plain.baseUrl).toBe(XENITION_BASE_URL);
  });

  it('setHeader mutates the shared default headers', () => {
    const client = makeClient();
    client.setHeader('x-session-token', 'tok_123');
    const instance = mockedAxios.create.mock.results[0]!.value as {
      defaults: { headers: { common: Record<string, string> } };
    };
    expect(instance.defaults.headers.common['x-session-token']).toBe('tok_123');
  });
});

/**
 * Idempotency, retries and the observability hooks. The retry rule is the
 * consequential one: a write is repeated only when the caller has said it is
 * safe to repeat.
 */
describe('idempotency and retries', () => {
  const transient = () => axiosError(null, undefined, 'socket hang up');

  it('retries a GET on a transient failure', async () => {
    requestMock
      .mockRejectedValueOnce(transient())
      .mockResolvedValue({ status: 200, data: { ok: true } });
    await expect(makeClient(2).get('/x')).resolves.toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry an unkeyed write', async () => {
    // A timeout is precisely the case where the first attempt may already
    // have succeeded, so repeating it can apply the change twice.
    requestMock.mockRejectedValue(transient());
    await expect(makeClient(2).post('/x', {})).rejects.toBeInstanceOf(XenitionError);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('DOES retry a write carrying an idempotency key', async () => {
    requestMock
      .mockRejectedValueOnce(transient())
      .mockResolvedValue({ status: 200, data: { ok: true } });
    await expect(
      makeClient(2).post('/x', {}, { idempotencyKey: 'order-1' }),
    ).resolves.toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('sends the key as a header and keeps it stable across attempts', async () => {
    requestMock
      .mockRejectedValueOnce(transient())
      .mockResolvedValue({ status: 200, data: {} });
    await makeClient(2).post('/x', {}, { idempotencyKey: 'order-1' });
    const keys = requestMock.mock.calls.map((call) => call[0].headers['idempotency-key']);
    expect(keys).toEqual(['order-1', 'order-1']);
  });

  it('does not leak the SDK option into the request config', async () => {
    requestMock.mockResolvedValue({ status: 200, data: {} });
    await makeClient().post('/x', {}, { idempotencyKey: 'k' });
    expect(requestMock.mock.calls[0][0]).not.toHaveProperty('idempotencyKey');
  });

  it('stamps one request id across every attempt of a call', async () => {
    // A retried call must read as one operation in the logs, not three.
    requestMock
      .mockRejectedValueOnce(transient())
      .mockResolvedValue({ status: 200, data: {} });
    await makeClient(2).get('/x');
    const ids = requestMock.mock.calls.map((call) => call[0].headers['x-request-id']);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(1);
  });
});

describe('observability hooks', () => {
  it('reports a successful request with its duration', async () => {
    const onRequest = jest.fn();
    const onResponse = jest.fn();
    requestMock.mockResolvedValue({ status: 200, data: {} });
    await new HttpClient('xen_service_test', { onRequest, onResponse }).get('/x');

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/x', attempt: 0 }),
    );
    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, durationMs: expect.any(Number) }),
    );
  });

  it('marks an error that will be retried, so logs do not read as N failures', async () => {
    const onError = jest.fn();
    requestMock
      .mockRejectedValueOnce(axiosError(null, undefined, 'boom'))
      .mockResolvedValue({ status: 200, data: {} });
    await new HttpClient('xen_service_test', { retries: 2, onError }).get('/x');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: true, attempt: 0, error: expect.any(XenitionError) }),
    );
  });

  it('marks the final failure as not retrying', async () => {
    const onError = jest.fn();
    requestMock.mockRejectedValue(axiosError(400, { error: { code: 'VALIDATION_ERROR' } }));
    await expect(
      new HttpClient('xen_service_test', { onError }).get('/x'),
    ).rejects.toBeInstanceOf(XenitionError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ willRetry: false }));
  });

  it('a throwing hook never breaks the request', async () => {
    // Adding logging must not become a way to break production.
    const boom = () => {
      throw new Error('bad logger');
    };
    requestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    await expect(
      new HttpClient('xen_service_test', { onRequest: boom, onResponse: boom }).get('/x'),
    ).resolves.toEqual({ ok: true });
  });
});

describe('HttpClient — 429 and Retry-After', () => {
  /**
   * A 429 is the most retriable failure there is: the server is not broken,
   * it is asking us to come back. It was the one transient code the retry
   * policy did not cover.
   */
  const throttled = (retryAfter?: string) => ({
    isAxiosError: true,
    message: 'Too Many Requests',
    response: {
      status: 429,
      data: {},
      headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
    },
  });

  it('retries a throttled GET instead of surfacing it', async () => {
    requestMock
      .mockRejectedValueOnce(throttled())
      .mockResolvedValue({ status: 200, data: { ok: true } });
    await expect(makeClient(2).get('/x')).resolves.toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('waits the number of seconds the server asked for', async () => {
    const slept: number[] = [];
    const client = makeClient(2);
    jest
      .spyOn(client as never, 'sleep')
      .mockImplementation(((ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      }) as never);
    requestMock
      .mockRejectedValueOnce(throttled('2'))
      .mockResolvedValue({ status: 200, data: {} });
    await client.get('/x');
    expect(slept).toEqual([2000]);
  });

  it('honours the HTTP-date form of the header too', async () => {
    const slept: number[] = [];
    const client = makeClient(2);
    jest
      .spyOn(client as never, 'sleep')
      .mockImplementation(((ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      }) as never);
    requestMock
      .mockRejectedValueOnce(throttled(new Date(Date.now() + 3000).toUTCString()))
      .mockResolvedValue({ status: 200, data: {} });
    await client.get('/x');
    // Second granularity in the header, so allow a little slack either way.
    expect(slept[0]).toBeGreaterThan(1500);
    expect(slept[0]).toBeLessThanOrEqual(3000);
  });

  it('refuses to sleep longer than the cap — the caller decides instead', async () => {
    // Holding a request open for two minutes is worse than an error: the
    // caller cannot see it happening and cannot queue the work.
    requestMock.mockRejectedValue(throttled('120'));
    const err = await caughtError(makeClient(2).get('/x'));
    expect(err.code).toBe('RATE_LIMITED');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('still refuses to replay a non-idempotent write', async () => {
    // Throttled at the door or not, an unkeyed POST is not safe to repeat.
    requestMock.mockRejectedValue(throttled());
    await expect(makeClient(2).post('/x', {})).rejects.toBeInstanceOf(XenitionError);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('jitters the backoff when there is no Retry-After', async () => {
    // Full jitter: without it, every client that failed in the same second
    // retries in the same second and the recovery is a thundering herd.
    const slept: number[] = [];
    const client = makeClient(3);
    jest
      .spyOn(client as never, 'sleep')
      .mockImplementation(((ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      }) as never);
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    requestMock
      .mockRejectedValueOnce(throttled())
      .mockRejectedValueOnce(throttled())
      .mockResolvedValue({ status: 200, data: {} });
    await client.get('/x');
    jest.spyOn(Math, 'random').mockRestore();
    // Half of the 100ms and 200ms ceilings, not the ceilings themselves.
    expect(slept).toEqual([50, 100]);
  });
});

/**
 * Cancellation. The timeout answers "how long will the SDK wait"; only the
 * caller can answer "do I still want this", and the answer must never be
 * confused with a transient fault.
 */
describe('caller cancellation', () => {
  /** What axios rejects with when the signal it was given fires. */
  const canceled = () => ({
    isAxiosError: true,
    name: 'CanceledError',
    code: 'ERR_CANCELED',
    message: 'canceled',
  });

  /** Abort the moment axios is called, the way a real abort arrives. */
  const abortsMidFlight = (controller: AbortController) =>
    requestMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(canceled());
    });

  it('forwards the signal to axios, so the socket is released and not just the promise', async () => {
    const controller = new AbortController();
    requestMock.mockResolvedValue({ status: 200, data: {} });
    await makeClient().get('/x', { signal: controller.signal });
    expect(requestMock.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it('rejects an aborted request as a cancellation rather than a transport fault', async () => {
    const controller = new AbortController();
    abortsMidFlight(controller);
    const err = await caughtError(makeClient().get('/x', { signal: controller.signal }));
    expect(isCancelledError(err)).toBe(true);
    expect(err.message).toMatch(/cancelled by the caller/);
  });

  it('never retries an abort — cancelling is a decision, not a transient failure', async () => {
    const controller = new AbortController();
    abortsMidFlight(controller);
    await caughtError(makeClient(3).get('/x', { signal: controller.signal }));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('does not dial at all when the signal was already aborted before the call', async () => {
    // The unmounted-effect shape: by the time the request would go out, the
    // caller has already gone. Dialling and then cancelling costs a
    // connection, and for a write may still apply the change.
    const controller = new AbortController();
    controller.abort();
    requestMock.mockResolvedValue({ status: 200, data: {} });
    const err = await caughtError(makeClient(2).post('/x', {}, { signal: controller.signal }));
    expect(isCancelledError(err)).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('recognises an abort raised through a handle we were not given', async () => {
    // Some runtimes reject with a bare DOM AbortError and never touch the
    // signal object we hold, so the shape of the rejection has to count too.
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    requestMock.mockRejectedValue(abortError);
    const err = await caughtError(makeClient(2).get('/x'));
    expect(isCancelledError(err)).toBe(true);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a real failure for a cancellation', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const err = await caughtError(makeClient().get('/x'));
    expect(isCancelledError(err)).toBe(false);
    expect(err.code).toBe('SERVER_ERROR');
  });

  it('cancels a stream through the same signal instead of holding the body open', async () => {
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      return Promise.reject(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    try {
      const err = await caughtError(
        makeClient().stream('/ai/chat', {}, { signal: controller.signal }),
      );
      expect(isCancelledError(err)).toBe(true);
    } finally {
      (globalThis as { fetch: unknown }).fetch = originalFetch;
    }
  });
});

/**
 * The circuit breaker. Without it, a gateway that is down makes every call
 * pay the whole timeout budget to learn a fact the first call already
 * established.
 */
describe('circuit breaker', () => {
  const breakered = (
    circuitBreaker: boolean | CircuitBreakerOptions,
    retries = 0,
  ) => new HttpClient('xen_service_test', { retries, circuitBreaker });

  /** Long enough that no test accidentally waits it out. */
  const NEVER_REOPENS = { failureThreshold: 2, coolOffMs: 60_000 };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const failNTimes = async (client: HttpClient, n: number) => {
    for (let i = 0; i < n; i++) await caughtError(client.get('/x'));
  };

  it('is off unless asked for, so a healthy client behaves exactly as before', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const client = makeClient(0);
    await failNTimes(client, 8);
    expect(requestMock).toHaveBeenCalledTimes(8);
  });

  it('opens after a run of 5xx answers and then fails fast without dialling', async () => {
    requestMock.mockRejectedValue(axiosError(503));
    const client = breakered(NEVER_REOPENS);
    await failNTimes(client, 2);
    expect(requestMock).toHaveBeenCalledTimes(2);

    const err = await caughtError(client.get('/x'));
    expect(err.message).toMatch(/stopped dialling/);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('counts a transport failure that never got a response at all', async () => {
    requestMock.mockRejectedValue(axiosError(null));
    const client = breakered(NEVER_REOPENS);
    await failNTimes(client, 3);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('takes five consecutive failures to open on the default settings', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const client = breakered(true);
    await failNTimes(client, 6);
    // Five dials opened it; the sixth call never reached the network.
    expect(requestMock).toHaveBeenCalledTimes(5);
  });

  it('reports the fail-fast as NETWORK_ERROR, the code the dial itself would have produced', async () => {
    // So an app that already handles an unreachable gateway handles this
    // too, without learning a new code to cope with a faster failure.
    requestMock.mockRejectedValue(axiosError(null));
    const client = breakered(NEVER_REOPENS);
    await failNTimes(client, 2);
    const err = await caughtError(client.get('/x'));
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('never opens on a 4xx, because a gateway that answers is a gateway that is up', async () => {
    requestMock.mockRejectedValue(axiosError(404));
    const client = breakered(NEVER_REOPENS);
    await failNTimes(client, 6);
    expect(requestMock).toHaveBeenCalledTimes(6);
  });

  it('never opens on a 429 either — being throttled means the gateway is alive', async () => {
    requestMock.mockRejectedValue(axiosError(429));
    const client = breakered(NEVER_REOPENS);
    await failNTimes(client, 6);
    expect(requestMock).toHaveBeenCalledTimes(6);
  });

  it('never opens on a 2xx envelope failure, which arrives over a working connection', async () => {
    requestMock.mockResolvedValue({
      status: 200,
      data: { success: false, error: { code: 'QUERY_FAILED', message: 'bad query' } },
    });
    const client = breakered(NEVER_REOPENS);
    await failNTimes(client, 6);
    expect(requestMock).toHaveBeenCalledTimes(6);
  });

  it('resets the run when the gateway answers, so scattered failures never add up', async () => {
    const client = breakered(NEVER_REOPENS);
    requestMock.mockRejectedValueOnce(axiosError(500));
    await caughtError(client.get('/x'));
    requestMock.mockResolvedValueOnce({ status: 200, data: {} });
    await client.get('/x');
    requestMock.mockRejectedValue(axiosError(500));
    await caughtError(client.get('/x'));
    // Two failures, but not consecutive, so nothing is open.
    await caughtError(client.get('/x'));
    expect(requestMock).toHaveBeenCalledTimes(4);
  });

  it('stops retrying inside the call whose own failures opened the circuit', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const client = breakered({ failureThreshold: 2, coolOffMs: 60_000 }, 3);
    const err = await caughtError(client.get('/x'));
    // Two attempts opened it; the caller still gets the real cause, not the
    // fail-fast, because that is what actually went wrong.
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(err.code).toBe('SERVER_ERROR');
  });

  it('lets a single trial request through after the cool-off and closes on success', async () => {
    requestMock.mockRejectedValueOnce(axiosError(500));
    const client = breakered({ failureThreshold: 1, coolOffMs: 5 });
    await caughtError(client.get('/x'));
    await caughtError(client.get('/x'));
    expect(requestMock).toHaveBeenCalledTimes(1);

    await wait(15);
    requestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    await expect(client.get('/x')).resolves.toEqual({ ok: true });
    // Closed again: the call after the trial dials without waiting.
    await client.get('/x');
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('reopens for a fresh cool-off when the trial request fails too', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const client = breakered({ failureThreshold: 1, coolOffMs: 5 });
    await caughtError(client.get('/x'));
    await wait(15);
    await caughtError(client.get('/x'));
    const err = await caughtError(client.get('/x'));
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(err.message).toMatch(/stopped dialling/);
  });

  it('admits one trial at a time, so recovery is probed and not stampeded', async () => {
    requestMock.mockRejectedValueOnce(axiosError(500));
    const client = breakered({ failureThreshold: 1, coolOffMs: 5 });
    await caughtError(client.get('/x'));
    await wait(15);

    let finish: (value: unknown) => void = () => {};
    requestMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const trial = client.get('/x');
    const blocked = await caughtError(client.get('/y'));
    expect(blocked.message).toMatch(/stopped dialling/);
    expect(requestMock).toHaveBeenCalledTimes(2);

    finish({ status: 200, data: { ok: true } });
    await expect(trial).resolves.toEqual({ ok: true });
  });

  it('hands the trial slot back when the trial is cancelled, which proved nothing', async () => {
    // A cancelled probe that kept the slot would leave the circuit blocked
    // with nobody left to test recovery.
    requestMock.mockRejectedValueOnce(axiosError(500));
    const client = breakered({ failureThreshold: 1, coolOffMs: 5 });
    await caughtError(client.get('/x'));
    await wait(15);

    const controller = new AbortController();
    requestMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject({ isAxiosError: true, code: 'ERR_CANCELED', message: 'canceled' });
    });
    await caughtError(client.get('/x', { signal: controller.signal }));

    requestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    await expect(client.get('/x')).resolves.toEqual({ ok: true });
  });

  it('reports the fail-fast to onError, so an outage is still visible in the logs', async () => {
    const onError = jest.fn();
    requestMock.mockRejectedValue(axiosError(500));
    const client = new HttpClient('xen_service_test', {
      retries: 0,
      circuitBreaker: { failureThreshold: 1, coolOffMs: 60_000 },
      onError,
    });
    await caughtError(client.get('/x'));
    onError.mockClear();
    await caughtError(client.get('/x'));
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: false, durationMs: 0, error: expect.any(XenitionError) }),
    );
  });
});
