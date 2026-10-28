import { base64UrlEncodeJson, bytesToBase64Url, importEs256PrivateKey, pemToDer, signJwt } from './jws';
import { APPLE_ROOT_CA_G3_SHA256, parseCertificate, verifyJwsX5c } from './x509';
import { APPLE_ROOT_G3_DER_B64, EVIL_ROOT_PEM, INTERMEDIATE_PEM, LEAF_KEY_PKCS8, LEAF_PEM, ROOT_PEM } from './x509.fixtures';

const b64 = (pem: string) => Buffer.from(pemToDer(pem)).toString('base64');
const sha256 = async (pem: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pemToDer(pem) as unknown as ArrayBuffer)), (b) => b.toString(16).padStart(2, '0')).join('');

const sign = async (payload: Record<string, unknown>, x5c: string[]) =>
  signJwt({ alg: 'ES256', x5c }, payload, await importEs256PrivateKey(LEAF_KEY_PKCS8));

describe('parseCertificate', () => {
  it('reads curve, validity and signature algorithm', () => {
    const leaf = parseCertificate(pemToDer(LEAF_PEM));
    expect(leaf.curve).toBe('1.2.840.10045.3.1.7');
    expect(leaf.signatureAlgorithm).toBe('1.2.840.10045.4.3.3');
    expect(leaf.notAfter).toBeGreaterThan(Date.now());
    expect(parseCertificate(pemToDer(ROOT_PEM)).curve).toBe('1.3.132.0.34');
  });

  it('reads the real Apple Root CA - G3, whose SHA-256 is the pinned default', async () => {
    const der = new Uint8Array(Buffer.from(APPLE_ROOT_G3_DER_B64, 'base64'));
    const apple = parseCertificate(der);
    expect(apple.curve).toBe('1.3.132.0.34');
    expect(apple.signatureAlgorithm).toBe('1.2.840.10045.4.3.3');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', der as unknown as ArrayBuffer)), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(digest).toBe(APPLE_ROOT_CA_G3_SHA256);
  });
});

describe('verifyJwsX5c', () => {
  const chain = () => [b64(LEAF_PEM), b64(INTERMEDIATE_PEM), b64(ROOT_PEM)];

  it('accepts a JWS signed by the leaf of a chain ending at a pinned root', async () => {
    const token = await sign({ notificationType: 'DID_RENEW' }, chain());
    const payload = await verifyJwsX5c(token, { rootFingerprints: [await sha256(ROOT_PEM)] });
    expect(payload).toMatchObject({ notificationType: 'DID_RENEW' });
  });

  it('pins Apple Root CA - G3 by default, so a test root is refused', async () => {
    expect(APPLE_ROOT_CA_G3_SHA256).toHaveLength(64);
    const token = await sign({ a: 1 }, chain());
    await expect(verifyJwsX5c(token)).rejects.toThrow(/pinned root/);
  });

  it('refuses a chain that ends at a look-alike root with a different key', async () => {
    const token = await sign({ a: 1 }, [b64(LEAF_PEM), b64(INTERMEDIATE_PEM), b64(EVIL_ROOT_PEM)]);
    await expect(verifyJwsX5c(token, { rootFingerprints: [await sha256(EVIL_ROOT_PEM)] })).rejects.toThrow(/does not verify/);
  });

  it('refuses a tampered payload', async () => {
    const token = await sign({ status: 'expired' }, chain());
    const [h, , s] = token.split('.');
    const forged = `${h}.${base64UrlEncodeJson({ status: 'active' })}.${s}`;
    await expect(verifyJwsX5c(forged, { rootFingerprints: [await sha256(ROOT_PEM)] })).rejects.toThrow(/signature does not verify/);
  });

  it('refuses a JWS with no chain, or the wrong algorithm', async () => {
    const bare = `${base64UrlEncodeJson({ alg: 'ES256' })}.${base64UrlEncodeJson({})}.${bytesToBase64Url(new Uint8Array([1]))}`;
    await expect(verifyJwsX5c(bare)).rejects.toThrow(/no certificate chain/);
    const hs = `${base64UrlEncodeJson({ alg: 'HS256', x5c: chain() })}.${base64UrlEncodeJson({})}.${bytesToBase64Url(new Uint8Array([1]))}`;
    await expect(verifyJwsX5c(hs)).rejects.toThrow(/ES256/);
  });

  it('refuses a chain outside its validity', async () => {
    const token = await sign({ a: 1 }, chain());
    await expect(verifyJwsX5c(token, { rootFingerprints: [await sha256(ROOT_PEM)], now: Date.UTC(2001, 0, 1) })).rejects.toThrow(/out of date/);
  });
});
