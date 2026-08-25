import { RecordPurchaseInput } from './billing-client';
export interface GoogleConfig {
    /** Android application id, e.g. `com.acme.app`. */
    packageName: string;
    /** Service account `client_email` from the downloaded JSON. */
    clientEmail: string;
    /** Service account `private_key` from the downloaded JSON (PEM). */
    privateKey: string;
    /** Override the OAuth token endpoint (the JSON's `token_uri`). */
    tokenUrl?: string;
    /** Override for tests. */
    fetchImpl?: typeof fetch;
}
export declare class GoogleStore {
    private readonly config;
    private readonly fetchImpl;
    private readonly tokenUrl;
    private tokenCache?;
    constructor(config: GoogleConfig);
    /**
     * Verify a purchase and produce the record for `billing.recordPurchase()`.
     *
     * `kind` decides which Play endpoint answers. Subscriptions and one-time
     * products live behind different URLs with different response shapes, and
     * Play returns 404 rather than redirecting if you ask the wrong one.
     */
    verify(input: {
        userId: string;
        productId: string;
        purchaseToken: string;
        kind?: 'subscription' | 'product';
    }): Promise<RecordPurchaseInput>;
    private verifySubscription;
    private verifyProduct;
    /**
     * Acknowledge a purchase.
     *
     * Play AUTOMATICALLY REFUNDS any purchase not acknowledged within three
     * days. Verification alone does not acknowledge, so an app that only
     * verifies quietly refunds every sale three days later — call this once
     * verification succeeds. It is idempotent on Play's side.
     */
    acknowledge(input: {
        productId: string;
        purchaseToken: string;
        kind?: 'subscription' | 'product';
    }): Promise<void>;
    /** True when the purchase still needs acknowledging. */
    static needsAcknowledgement(raw: Record<string, unknown>): boolean;
    private get;
    private post;
    private call;
    /**
     * OAuth access token from the service-account JWT, cached until shortly
     * before expiry. Every verification would otherwise cost two round trips.
     */
    private accessToken;
}
/** Play sends RFC-3339 strings on the v2 endpoints. Normalize to ISO. */
export declare function asIso(value: unknown): string | null;
/** …and epoch-millisecond STRINGS on the older product endpoints. */
export declare function msToIso(value: unknown): string | null;
//# sourceMappingURL=google.d.ts.map