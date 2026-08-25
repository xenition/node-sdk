import { RecordPurchaseInput } from './billing-client';
import { PurchaseStatus } from './types';
export interface AppleConfig {
    /** Key ID of the App Store Connect API key (the `.p8` filename stem). */
    keyId: string;
    /** Issuer ID from App Store Connect → Users and Access → Integrations. */
    issuerId: string;
    /** Contents of the `.p8` file. PEM armor optional. */
    privateKey: string;
    /** Your app's bundle id, e.g. `com.acme.app`. */
    bundleId: string;
    /**
     * Which Apple environment to query.
     *
     * Default `auto`: try production, and fall back to sandbox when Apple
     * says it has never heard of the transaction. TestFlight and simulator
     * purchases only exist in sandbox, so without the fallback every internal
     * tester looks like a fraudster — and hardcoding sandbox would let a real
     * user unlock premium with a sandbox receipt.
     */
    environment?: 'production' | 'sandbox' | 'auto';
    /** Override for tests. */
    fetchImpl?: typeof fetch;
}
/** Apple's decoded transaction payload, as far as billing cares. */
export interface AppleTransaction {
    transactionId: string;
    originalTransactionId: string;
    productId: string;
    bundleId?: string;
    /** Milliseconds since epoch. */
    purchaseDate?: number;
    expiresDate?: number;
    revocationDate?: number;
    revocationReason?: number;
    type?: string;
    environment?: string;
    inAppOwnershipType?: string;
    [key: string]: unknown;
}
export declare class AppleStore {
    private readonly config;
    private readonly fetchImpl;
    private tokenCache?;
    constructor(config: AppleConfig);
    /**
     * Verify one transaction id and produce the record for
     * `billing.recordPurchase()`.
     *
     * For an auto-renewable subscription this also reads the CURRENT
     * subscription status, so a transaction id captured at purchase time
     * still yields the right answer months later — the device's copy of a
     * receipt cannot tell you whether the sub was since cancelled or refunded.
     */
    verify(input: {
        userId: string;
        transactionId: string;
    }): Promise<RecordPurchaseInput>;
    /**
     * Every transaction Apple knows for this customer — the "Restore
     * Purchases" path, and the only correct answer after a reinstall.
     */
    restore(input: {
        userId: string;
        originalTransactionId: string;
    }): Promise<RecordPurchaseInput[]>;
    /** Fetch and decode one transaction, remembering which host answered. */
    private lookupTransaction;
    /** Current status of a subscription chain. */
    private subscriptionStatus;
    /**
     * GET an App Store Server API path, handling the production/sandbox
     * split. When `host` is given the environment is already settled (a
     * follow-up call in the same flow) and no fallback is attempted.
     */
    private request;
    private candidateHosts;
    /**
     * The ES256 JWT Apple wants, cached until shortly before it expires.
     * Signing is cheap but not free, and this runs on every verification.
     */
    private bearerToken;
    /**
     * A transaction for a DIFFERENT app is not ours to honour. Apple scopes
     * the API key to a team, not to one bundle, so this is the check that
     * stops a receipt from a sibling app unlocking this one.
     */
    private assertBundle;
}
/** Normalize Apple's decoded transaction into the SDK's purchase shape. */
export declare function toRecordInput(userId: string, transaction: AppleTransaction, status: PurchaseStatus, autoRenewing: boolean, environment?: string): RecordPurchaseInput;
/** Apple sends epoch milliseconds; the SDK stores ISO strings. */
export declare function msToIso(value: unknown): string | null;
/**
 * Which Apple environment a purchase belongs to.
 *
 * Taken from the host that ANSWERED rather than the `environment` field in
 * the payload: the host is what the request actually reached, and it cannot
 * be stale or absent. A sandbox purchase must never unlock production.
 */
export declare function environmentOf(host: string): string;
//# sourceMappingURL=apple.d.ts.map