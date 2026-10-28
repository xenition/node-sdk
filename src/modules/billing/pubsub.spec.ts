import { bytesToBase64Url, base64UrlEncodeJson } from './jws';
import { verifyPubSubToken } from './pubsub';

/** A Google-like RS256 signer and the JWKS that publishes its key. */
const makeGoogle = async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const sign = async (claims: Record<string, unknown>, kid = 'k1') => {
    const input = `${base64UrlEncodeJson({ alg: 'RS256', kid, typ: 'JWT' })}.${base64UrlEncodeJson(claims)}`;
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input)));
    return `${input}.${bytesToBase64Url(sig)}`;
  };
  const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) })) as unknown as typeof fetch;
  return { sign, fetchImpl };
};

const now = () => Math.floor(Date.now() / 1000);
const good = { iss: 'https://accounts.google.com', aud: 'https://app.example/billing', email: 'rtdn@proj.iam.gserviceaccount.com', email_verified: true };

describe('verifyPubSubToken', () => {
  it('accepts a Google-signed push token with the expected audience and account', async () => {
    const g = await makeGoogle();
    const token = await g.sign({ ...good, exp: now() + 300 });
    const claims = await verifyPubSubToken(`Bearer ${token}`, {
      audience: good.aud,
      serviceAccountEmail: good.email,
      fetchImpl: g.fetchImpl,
      jwksUrl: 'https://jwks.test/1',
    });
    expect(claims.email).toBe(good.email);
  });

  it('refuses: no token, wrong audience, wrong account, expired, not Google, forged', async () => {
    const g = await makeGoogle();
    const opts = { fetchImpl: g.fetchImpl, jwksUrl: 'https://jwks.test/2' };
    await expect(verifyPubSubToken(undefined, opts)).rejects.toThrow(/no bearer/);
    await expect(verifyPubSubToken(await g.sign({ ...good, exp: now() + 300 }), { ...opts, audience: 'other' })).rejects.toThrow(/audience/);
    await expect(verifyPubSubToken(await g.sign({ ...good, exp: now() + 300 }), { ...opts, serviceAccountEmail: 'x@y' })).rejects.toThrow(/service account/);
    await expect(verifyPubSubToken(await g.sign({ ...good, exp: now() - 10 }), opts)).rejects.toThrow(/expired/);
    await expect(verifyPubSubToken(await g.sign({ ...good, iss: 'evil', exp: now() + 300 }), opts)).rejects.toThrow(/not from Google/);
    const other = await makeGoogle();
    await expect(verifyPubSubToken(await other.sign({ ...good, exp: now() + 300 }), opts)).rejects.toThrow(/does not verify/);
    await expect(verifyPubSubToken(await g.sign({ ...good, exp: now() + 300 }, 'k9'), opts)).rejects.toThrow(/unknown key/);
  });
});
