/**
 * JWS/JWT primitives for the store adapters, built on Web Crypto only.
 *
 * Deliberately no `jsonwebtoken`, no `node:crypto`, no Buffer: this code
 * runs inside the generated app's Cloudflare Worker, where none of those
 * exist. `crypto.subtle` is available in Workers and in Node 18+, so one
 * implementation serves both.
 *
 * Apple speaks JWS in both directions — you authenticate to the App Store
 * Server API with an ES256 JWT you sign, and it answers with signed
 * transaction payloads. Google wants an RS256 JWT to mint an OAuth token.
 */

const TEXT = new TextEncoder();

/**
 * The platform's key handle. Derived from the API rather than named:
 * `CryptoKey` is a DOM lib type, and the node build compiles with
 * `lib: ES2020` on purpose — pulling in DOM to name one type would let
 * browser globals type-check their way into a server bundle.
 */
export type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/* ── base64url ─────────────────────────────────────────────────────────── */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncodeJson(value: unknown): string {
  return bytesToBase64Url(TEXT.encode(JSON.stringify(value)));
}

/* ── JWS decoding ──────────────────────────────────────────────────────── */

export interface JwsParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** The `header.payload` bytes the signature covers. */
  signingInput: Uint8Array;
  signature: Uint8Array;
}

/** Split a compact JWS into its parts. Performs NO signature checking. */
export function parseJws(token: string): JwsParts {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new Error(`parseJws: expected 3 JWS segments, got ${segments.length}`);
  }
  const [headerSeg, payloadSeg, signatureSeg] = segments as [string, string, string];
  return {
    header: decodeSegment(headerSeg, 'header'),
    payload: decodeSegment(payloadSeg, 'payload'),
    signingInput: TEXT.encode(`${headerSeg}.${payloadSeg}`),
    signature: base64UrlToBytes(signatureSeg),
  };
}

/**
 * The payload of a signed token, WITHOUT verifying the signature.
 *
 * Only safe when the transport already established authenticity — i.e. we
 * fetched this token from Apple ourselves over TLS. Anything that arrives
 * from the network unsolicited (a webhook) must go through
 * `verifyJwsSignature` first; the naming is blunt on purpose.
 */
export function decodeJwsPayloadUnverified<T = Record<string, unknown>>(token: string): T {
  return parseJws(token).payload as T;
}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  let text: string;
  try {
    text = new TextDecoder().decode(base64UrlToBytes(segment));
  } catch {
    throw new Error(`parseJws: ${what} is not valid base64url`);
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`parseJws: ${what} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/* ── key import ────────────────────────────────────────────────────────── */

/** Strip PEM armor and decode the DER body. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('pemToDer: no PEM body found');
  return base64UrlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_'));
}

/**
 * Import an App Store Connect `.p8` private key (PKCS#8, EC P-256).
 *
 * The file downloaded from App Store Connect is already PKCS#8 PEM, so it
 * can be pasted into a secret verbatim — with or without the armor lines,
 * and with any line wrapping.
 */
export function importEs256PrivateKey(privateKeyPem: string): Promise<SubtleKey> {
  const der = pemToDer(privateKeyPem);
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(der),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** Import a Google service-account RSA private key (PKCS#8 PEM) for RS256. */
export function importRs256PrivateKey(privateKeyPem: string): Promise<SubtleKey> {
  const der = pemToDer(privateKeyPem);
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(der),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/* ── signing ───────────────────────────────────────────────────────────── */

/**
 * Sign a compact JWT.
 *
 * WebCrypto's ECDSA output is already the raw `r||s` pair JWS wants, so no
 * DER unwrapping is needed — unlike `node:crypto`, which returns DER and
 * trips people up here.
 */
export async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: SubtleKey,
): Promise<string> {
  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const algorithm =
    key.algorithm.name === 'ECDSA'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: 'RSASSA-PKCS1-v1_5' };
  const signature = await crypto.subtle.sign(algorithm, key, TEXT.encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** A `Uint8Array` view as a standalone ArrayBuffer, for the WebCrypto calls. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
