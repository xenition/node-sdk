import { base64UrlToBytes, parseJws, toArrayBuffer } from './jws';

/**
 * Just enough X.509 to check the certificate chain an App Store Server
 * Notification (v2) is signed with — on WebCrypto, so it runs in Workers,
 * Deno and Node alike, with no dependency.
 *
 * Apple signs `signedPayload` as an ES256 JWS whose header carries `x5c`:
 * [leaf, intermediate (Apple WWDR), root (Apple Root CA - G3)]. Verifying it
 * means: every certificate is in date, each is signed by the next, the root is
 * one we pinned (by SHA-256 fingerprint of its DER), and the JWS is signed by
 * the leaf's key. That is what this does — nothing more general.
 *
 * It is a SECOND layer. The billing handlers already treat a notification as
 * a trigger and re-read the state from the store, so a forged one cannot
 * grant anything; checking the chain also stops a forged one from costing a
 * store lookup or reaching the audit log.
 */

/** SHA-256 of Apple Root CA - G3 (DER), from apple.com/certificateauthority. */
export const APPLE_ROOT_CA_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
};

interface Tlv {
  tag: number;
  /** The whole element, header included. */
  full: Uint8Array;
  /** Contents only. */
  body: Uint8Array;
}

function readTlv(bytes: Uint8Array, offset: number): { tlv: Tlv; next: number } {
  const tag = bytes[offset];
  if (tag === undefined) throw new Error('x509: truncated DER');
  let length = bytes[offset + 1] ?? 0;
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count < 1 || count > 4) throw new Error('x509: unsupported DER length');
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + (bytes[offset + 2 + i] ?? 0);
    header += count;
  }
  const end = offset + header + length;
  if (end > bytes.length) throw new Error('x509: truncated DER');
  return { tlv: { tag, full: bytes.subarray(offset, end), body: bytes.subarray(offset + header, end) }, next: end };
}

function children(body: Uint8Array): Tlv[] {
  const out: Tlv[] = [];
  let at = 0;
  while (at < body.length) {
    const { tlv, next } = readTlv(body, at);
    out.push(tlv);
    at = next;
  }
  return out;
}

function oid(body: Uint8Array): string {
  const first = body[0] ?? 0;
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let i = 1; i < body.length; i += 1) {
    const byte = body[i] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function time(t: Tlv): number {
  const text = new TextDecoder().decode(t.body);
  // UTCTime YYMMDDHHMMSSZ (tag 0x17) or GeneralizedTime YYYYMMDDHHMMSSZ (0x18).
  const full = t.tag === 0x17 ? `${Number(text.slice(0, 2)) >= 50 ? '19' : '20'}${text}` : text;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(full);
  if (!m) throw new Error('x509: unreadable validity time');
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export interface ParsedCertificate {
  der: Uint8Array;
  tbs: Uint8Array;
  signatureAlgorithm: string;
  /** DER-encoded ECDSA signature. */
  signature: Uint8Array;
  spki: Uint8Array;
  curve: string;
  notBefore: number;
  notAfter: number;
}

export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const cert = readTlv(der, 0).tlv;
  const [tbsTlv, algTlv, sigTlv] = children(cert.body);
  if (!tbsTlv || !algTlv || !sigTlv) throw new Error('x509: not a certificate');
  const tbs = children(tbsTlv.body);
  // [0] version is optional; the remaining fields are positional.
  const fields = tbs[0]?.tag === 0xa0 ? tbs.slice(1) : tbs;
  const [, , , validity, , spkiTlv] = fields;
  if (!validity || !spkiTlv) throw new Error('x509: incomplete certificate');
  const [notBefore, notAfter] = children(validity.body);
  const spkiAlg = children(children(spkiTlv.body)[0]?.body ?? new Uint8Array());
  const algorithm = children(algTlv.body)[0];
  return {
    der: cert.full,
    tbs: tbsTlv.full,
    signatureAlgorithm: algorithm ? oid(algorithm.body) : '',
    // BIT STRING: first byte is the unused-bits count.
    signature: sigTlv.body.subarray(1),
    spki: spkiTlv.full,
    curve: spkiAlg[1] ? oid(spkiAlg[1].body) : '',
    notBefore: notBefore ? time(notBefore) : 0,
    notAfter: notAfter ? time(notAfter) : 0,
  };
}

/** DER ECDSA-Sig-Value → the raw r‖s WebCrypto wants. */
function rawSignature(der: Uint8Array, size: number): Uint8Array {
  const [r, s] = children(readTlv(der, 0).tlv.body);
  if (!r || !s) throw new Error('x509: bad ECDSA signature');
  const out = new Uint8Array(size * 2);
  const put = (int: Uint8Array, at: number) => {
    const trimmed = int[0] === 0 ? int.subarray(1) : int;
    if (trimmed.length > size) throw new Error('x509: bad ECDSA signature');
    out.set(trimmed, at + size - trimmed.length);
  };
  put(r.body, 0);
  put(s.body, size);
  return out;
}

const CURVES: Record<string, { name: 'P-256' | 'P-384'; size: number }> = {
  [OID.p256]: { name: 'P-256', size: 32 },
  [OID.p384]: { name: 'P-384', size: 48 },
};

async function importSpki(cert: ParsedCertificate) {
  const curve = CURVES[cert.curve];
  if (!curve) throw new Error(`x509: unsupported key curve ${cert.curve}`);
  const key = await crypto.subtle.importKey('spki', toArrayBuffer(cert.spki), { name: 'ECDSA', namedCurve: curve.name }, false, ['verify']);
  return { key, size: curve.size };
}

/** Is `cert` signed by `issuer`'s key? */
async function signedBy(cert: ParsedCertificate, issuer: ParsedCertificate): Promise<boolean> {
  const hash = cert.signatureAlgorithm === OID.ecdsaSha384 ? 'SHA-384' : cert.signatureAlgorithm === OID.ecdsaSha256 ? 'SHA-256' : null;
  if (!hash) return false;
  const { key, size } = await importSpki(issuer);
  return crypto.subtle.verify({ name: 'ECDSA', hash }, key, toArrayBuffer(rawSignature(cert.signature, size)), toArrayBuffer(cert.tbs));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string): Uint8Array {
  return base64UrlToBytes(value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

export interface VerifyX5cOptions {
  /** Pinned root fingerprints (SHA-256 hex of the DER). Defaults to Apple Root CA - G3. */
  rootFingerprints?: string[];
  /** Override "now" (tests). */
  now?: number;
}

/**
 * Verify an x5c-signed ES256 JWS and return its payload. Throws with a
 * reason when anything does not hold.
 */
export async function verifyJwsX5c<T = Record<string, unknown>>(token: string, options: VerifyX5cOptions = {}): Promise<T> {
  const parts = parseJws(token);
  const header = parts.header as { alg?: string; x5c?: unknown };
  if (header.alg !== 'ES256') throw new Error('x509: expected an ES256 JWS');
  const chain = Array.isArray(header.x5c) ? header.x5c.filter((c): c is string => typeof c === 'string') : [];
  if (chain.length < 2) throw new Error('x509: the JWS carries no certificate chain');

  const certs = chain.map((c) => parseCertificate(base64ToBytes(c)));
  const now = options.now ?? Date.now();
  for (const cert of certs) {
    if (now < cert.notBefore || now > cert.notAfter) throw new Error('x509: a certificate in the chain is out of date');
  }
  for (let i = 0; i < certs.length - 1; i += 1) {
    if (!(await signedBy(certs[i]!, certs[i + 1]!))) throw new Error('x509: the chain does not verify');
  }
  const root = certs[certs.length - 1]!;
  const pinned = (options.rootFingerprints ?? [APPLE_ROOT_CA_G3_SHA256]).map((f) => f.replace(/:/g, '').toLowerCase());
  if (!pinned.includes(await sha256Hex(root.der))) throw new Error('x509: the chain does not end at a pinned root');

  const { key } = await importSpki(certs[0]!);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    toArrayBuffer(parts.signature),
    toArrayBuffer(parts.signingInput),
  );
  if (!ok) throw new Error('x509: the JWS signature does not verify');
  return parts.payload as T;
}
