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
export declare const APPLE_ROOT_CA_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
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
export declare function parseCertificate(der: Uint8Array): ParsedCertificate;
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
export declare function verifyJwsX5c<T = Record<string, unknown>>(token: string, options?: VerifyX5cOptions): Promise<T>;
//# sourceMappingURL=x509.d.ts.map