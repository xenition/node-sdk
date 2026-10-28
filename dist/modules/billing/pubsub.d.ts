export interface VerifyPubSubOptions {
    /** The audience set on the push subscription. Checked when given. */
    audience?: string;
    /** The service account the subscription signs as. Checked when given. */
    serviceAccountEmail?: string;
    /** Override for tests. */
    fetchImpl?: typeof fetch;
    /** Override for tests. */
    jwksUrl?: string;
    now?: number;
}
/** Verify a push's `Authorization` header (or the bare token). Returns the token's claims; throws with a reason. */
export declare function verifyPubSubToken(authorization: string | undefined | null, options?: VerifyPubSubOptions): Promise<Record<string, unknown>>;
//# sourceMappingURL=pubsub.d.ts.map