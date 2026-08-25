import { Hono } from 'hono';
import { applyCors } from './router-utils';

/**
 * The preflight is the test. A policy that looks right in the source and
 * refuses the browser is exactly the failure this file exists to catch — it
 * shipped once already, allowing `GET, POST, OPTIONS` and `Content-Type`
 * while the SDK's own routers answered `PATCH`, `DELETE` and `PUT` and every
 * authenticated call carried `Authorization`.
 */
async function preflight(app: Hono, method: string, headers = 'authorization'): Promise<Response> {
  return await app.request('/anything', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example',
      'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': headers,
    },
  });
}

const allowed = (res: Response, header: string): string[] =>
  (res.headers.get(header) ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);

describe('applyCors', () => {
  it('allows every method the SDK routers actually answer', async () => {
    const app = new Hono();
    applyCors(app, undefined);
    const methods = allowed(await preflight(app, 'PATCH'), 'access-control-allow-methods');
    // cart PATCH/DELETE and notifications PUT are shipped routes; a policy
    // that refuses them refuses the SDK's own surface.
    expect(methods).toEqual(expect.arrayContaining(['get', 'post', 'put', 'patch', 'delete', 'options']));
  });

  it('allows Authorization, without which no signed-in request survives a preflight', async () => {
    const app = new Hono();
    applyCors(app, undefined);
    const headers = allowed(await preflight(app, 'GET'), 'access-control-allow-headers');
    expect(headers).toEqual(expect.arrayContaining(['content-type', 'authorization']));
  });

  it('takes an origin allowlist as an array, as it always did', async () => {
    const app = new Hono();
    applyCors(app, ['https://app.example']);
    const res = await preflight(app, 'GET');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
  });

  it('adds an app’s own header rather than making it turn CORS off', async () => {
    const app = new Hono();
    applyCors(app, { origin: ['https://app.example'], allowHeaders: ['X-Device-Key'] });
    const headers = allowed(await preflight(app, 'GET', 'x-device-key'), 'access-control-allow-headers');
    // The defaults survive: adding a header must not silently drop
    // Authorization, which is the trap in a "replace the list" API.
    expect(headers).toEqual(expect.arrayContaining(['content-type', 'authorization', 'x-device-key']));
  });

  it('writes no CORS headers at all when disabled', async () => {
    const app = new Hono();
    applyCors(app, false);
    const res = await preflight(app, 'GET');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses credentials against a wildcard origin, which a browser rejects silently', () => {
    const app = new Hono();
    expect(() => applyCors(app, { credentials: true })).toThrow(/explicit origin allowlist/);
  });
});
