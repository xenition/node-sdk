import { HttpClient } from '../core/http-client';
import { ApplyResult, Migration } from './types';
/** Name of the per-app ledger table the SDK maintains. */
export declare const MIGRATIONS_LEDGER_TABLE = "_sdk_migrations";
/**
 * sha-256 hex digest. Prefers Node's `crypto` (sync, always present on the
 * Node 18+ runtimes the SDK targets); falls back to WebCrypto
 * (`crypto.subtle`) so the checksum math itself is browser-safe. In
 * practice migrations are a service-key concern (raw SQL is 403 for anon
 * keys), so this runs on servers — the fallback just keeps the module
 * loadable anywhere.
 */
export declare function sha256Hex(text: string): Promise<string>;
/**
 * Content-addressed per-app migration ledger over `/app-platform/raw`.
 *
 *   await client.migrations.apply([
 *     { id: 'shop/0001_create_products', sql: 'CREATE TABLE IF NOT EXISTS ...' },
 *   ]);
 *
 * Semantics:
 *   - Ensures the `_sdk_migrations` ledger table exists (CREATE IF NOT
 *     EXISTS — cheap, idempotent).
 *   - Applies each *unapplied* migration in array order, recording
 *     `id` + sha-256(sql) in the ledger after each success.
 *   - Already-applied migrations are checksum-verified and skipped, so
 *     re-running `apply()` with the same set is a no-op.
 *   - If a recorded checksum differs from the current SQL for the same id,
 *     `apply()` throws — a migration is immutable once applied; ship a new
 *     id instead of editing an old one. Nothing is ever silently re-run.
 *
 * Requires a service key (raw SQL / DDL is rejected with 403 for anon
 * keys). Note v0 is client-side sequencing: statements run one at a time
 * over HTTP, not inside a single transaction — keep each migration a
 * single idempotent statement (CREATE TABLE/INDEX IF NOT EXISTS) so a
 * mid-run failure can simply be re-applied. Server-side transactional
 * migration support comes later per the platform plan.
 */
export declare class MigrationsClient {
    private readonly query;
    constructor(http: HttpClient);
    apply(migrations: Migration[]): Promise<ApplyResult>;
    private validateInput;
}
//# sourceMappingURL=migrations-client.d.ts.map