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
/**
 * The platform's key handle. Derived from the API rather than named:
 * `CryptoKey` is a DOM lib type, and the node build compiles with
 * `lib: ES2020` on purpose — pulling in DOM to name one type would let
 * browser globals type-check their way into a server bundle.
 */
export type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
export declare function bytesToBase64Url(bytes: Uint8Array): string;
export declare function base64UrlToBytes(value: string): Uint8Array;
export declare function base64UrlEncodeJson(value: unknown): string;
export interface JwsParts {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    /** The `header.payload` bytes the signature covers. */
    signingInput: Uint8Array;
    signature: Uint8Array;
}
/** Split a compact JWS into its parts. Performs NO signature checking. */
export declare function parseJws(token: string): JwsParts;
/**
 * The payload of a signed token, WITHOUT verifying the signature.
 *
 * Only safe when the transport already established authenticity — i.e. we
 * fetched this token from Apple ourselves over TLS. Anything that arrives
 * from the network unsolicited (a webhook) must go through
 * `verifyJwsSignature` first; the naming is blunt on purpose.
 */
export declare function decodeJwsPayloadUnverified<T = Record<string, unknown>>(token: string): T;
/** Strip PEM armor and decode the DER body. */
export declare function pemToDer(pem: string): Uint8Array;
/**
 * Import an App Store Connect `.p8` private key (PKCS#8, EC P-256).
 *
 * The file downloaded from App Store Connect is already PKCS#8 PEM, so it
 * can be pasted into a secret verbatim — with or without the armor lines,
 * and with any line wrapping.
 */
export declare function importEs256PrivateKey(privateKeyPem: string): Promise<SubtleKey>;
/** Import a Google service-account RSA private key (PKCS#8 PEM) for RS256. */
export declare function importRs256PrivateKey(privateKeyPem: string): Promise<SubtleKey>;
/**
 * Sign a compact JWT.
 *
 * WebCrypto's ECDSA output is already the raw `r||s` pair JWS wants, so no
 * DER unwrapping is needed — unlike `node:crypto`, which returns DER and
 * trips people up here.
 */
export declare function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: SubtleKey): Promise<string>;
/** A `Uint8Array` view as a standalone ArrayBuffer, for the WebCrypto calls. */
export declare function toArrayBuffer(bytes: Uint8Array): ArrayBuffer;
//# sourceMappingURL=jws.d.ts.map