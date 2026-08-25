"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bytesToBase64Url = bytesToBase64Url;
exports.base64UrlToBytes = base64UrlToBytes;
exports.base64UrlEncodeJson = base64UrlEncodeJson;
exports.parseJws = parseJws;
exports.decodeJwsPayloadUnverified = decodeJwsPayloadUnverified;
exports.pemToDer = pemToDer;
exports.importEs256PrivateKey = importEs256PrivateKey;
exports.importRs256PrivateKey = importRs256PrivateKey;
exports.signJwt = signJwt;
exports.toArrayBuffer = toArrayBuffer;
const TEXT = new TextEncoder();
/* ── base64url ─────────────────────────────────────────────────────────── */
function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBytes(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function base64UrlEncodeJson(value) {
    return bytesToBase64Url(TEXT.encode(JSON.stringify(value)));
}
/** Split a compact JWS into its parts. Performs NO signature checking. */
function parseJws(token) {
    const segments = token.split('.');
    if (segments.length !== 3) {
        throw new Error(`parseJws: expected 3 JWS segments, got ${segments.length}`);
    }
    const [headerSeg, payloadSeg, signatureSeg] = segments;
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
function decodeJwsPayloadUnverified(token) {
    return parseJws(token).payload;
}
function decodeSegment(segment, what) {
    let text;
    try {
        text = new TextDecoder().decode(base64UrlToBytes(segment));
    }
    catch {
        throw new Error(`parseJws: ${what} is not valid base64url`);
    }
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`parseJws: ${what} is not a JSON object`);
    }
    return parsed;
}
/* ── key import ────────────────────────────────────────────────────────── */
/** Strip PEM armor and decode the DER body. */
function pemToDer(pem) {
    const body = pem
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
    if (!body)
        throw new Error('pemToDer: no PEM body found');
    return base64UrlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_'));
}
/**
 * Import an App Store Connect `.p8` private key (PKCS#8, EC P-256).
 *
 * The file downloaded from App Store Connect is already PKCS#8 PEM, so it
 * can be pasted into a secret verbatim — with or without the armor lines,
 * and with any line wrapping.
 */
function importEs256PrivateKey(privateKeyPem) {
    const der = pemToDer(privateKeyPem);
    return crypto.subtle.importKey('pkcs8', toArrayBuffer(der), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
/** Import a Google service-account RSA private key (PKCS#8 PEM) for RS256. */
function importRs256PrivateKey(privateKeyPem) {
    const der = pemToDer(privateKeyPem);
    return crypto.subtle.importKey('pkcs8', toArrayBuffer(der), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
/* ── signing ───────────────────────────────────────────────────────────── */
/**
 * Sign a compact JWT.
 *
 * WebCrypto's ECDSA output is already the raw `r||s` pair JWS wants, so no
 * DER unwrapping is needed — unlike `node:crypto`, which returns DER and
 * trips people up here.
 */
async function signJwt(header, payload, key) {
    const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
    const algorithm = key.algorithm.name === 'ECDSA'
        ? { name: 'ECDSA', hash: 'SHA-256' }
        : { name: 'RSASSA-PKCS1-v1_5' };
    const signature = await crypto.subtle.sign(algorithm, key, TEXT.encode(signingInput));
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}
/** A `Uint8Array` view as a standalone ArrayBuffer, for the WebCrypto calls. */
function toArrayBuffer(bytes) {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}
//# sourceMappingURL=jws.js.map