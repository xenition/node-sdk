/**
 * Content-addressed per-app migration ledger — wire/IR types.
 *
 * A migration is `{id, sql}`. The ledger table `_sdk_migrations` records
 * each applied id together with the sha-256 checksum of its SQL, so a
 * migration whose SQL was edited after being applied is detected and
 * rejected instead of silently diverging from what actually ran.
 */
export interface Migration {
    /**
     * Stable, unique identifier — e.g. `cms/0001_create_cms__pages`.
     * Never reuse or rename an id once it has been applied anywhere:
     * the ledger is keyed by it.
     */
    id: string;
    /**
     * The exact SQL to execute (one statement; runs via `/app-platform/raw`,
     * so DDL requires a service key). Content-addressed: editing the SQL of
     * an already-applied migration makes `apply()` throw. Write a new
     * migration instead.
     */
    sql: string;
}
/** Row shape of the `_sdk_migrations` ledger table. */
export interface MigrationLedgerRow {
    id: string;
    checksum: string;
    applied_at?: string;
}
/** What `MigrationsClient.apply()` resolves with. */
export interface ApplyResult {
    /** Ids executed by this call, in the order they ran. */
    applied: string[];
    /** Ids already in the ledger (checksum verified) and skipped. */
    skipped: string[];
}
//# sourceMappingURL=types.d.ts.map