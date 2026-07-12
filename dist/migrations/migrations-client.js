"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationsClient = exports.MIGRATIONS_LEDGER_TABLE = void 0;
exports.sha256Hex = sha256Hex;
const query_client_1 = require("../query/query-client");
/** Name of the per-app ledger table the SDK maintains. */
exports.MIGRATIONS_LEDGER_TABLE = '_sdk_migrations';
const ENSURE_LEDGER_SQL = `CREATE TABLE IF NOT EXISTS ${exports.MIGRATIONS_LEDGER_TABLE} (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;
const SELECT_LEDGER_SQL = `SELECT id, checksum FROM ${exports.MIGRATIONS_LEDGER_TABLE}`;
const INSERT_LEDGER_SQL = `INSERT INTO ${exports.MIGRATIONS_LEDGER_TABLE} (id, checksum) VALUES ($1, $2)`;
/**
 * sha-256 hex digest. Prefers Node's `crypto` (sync, always present on the
 * Node 18+ runtimes the SDK targets); falls back to WebCrypto
 * (`crypto.subtle`) so the checksum math itself is browser-safe. In
 * practice migrations are a service-key concern (raw SQL is 403 for anon
 * keys), so this runs on servers — the fallback just keeps the module
 * loadable anywhere.
 */
async function sha256Hex(text) {
    try {
        // Deliberately not a static import so browser bundlers don't try to
        // resolve 'crypto' at build time.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodeCrypto = require('crypto');
        if (typeof nodeCrypto?.createHash === 'function') {
            return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
        }
    }
    catch {
        // Not a Node runtime — fall through to WebCrypto.
    }
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
        const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
    throw new Error('sha256Hex: no crypto implementation available (need Node "crypto" or WebCrypto crypto.subtle).');
}
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
class MigrationsClient {
    constructor(http) {
        this.query = new query_client_1.QueryClient(http);
    }
    async apply(migrations) {
        this.validateInput(migrations);
        await this.query.raw(ENSURE_LEDGER_SQL);
        const ledger = await this.query.raw(SELECT_LEDGER_SQL);
        const recorded = new Map(ledger.data.map((row) => [row.id, row.checksum]));
        const applied = [];
        const skipped = [];
        for (const migration of migrations) {
            const checksum = await sha256Hex(migration.sql);
            const existing = recorded.get(migration.id);
            if (existing !== undefined) {
                if (existing !== checksum) {
                    throw new Error(`MigrationsClient.apply: checksum mismatch for migration "${migration.id}" — ` +
                        `ledger has ${existing}, current SQL hashes to ${checksum}. ` +
                        'A migration is immutable once applied; do not edit its SQL. ' +
                        'Add a new migration with a new id instead.');
                }
                skipped.push(migration.id);
                continue;
            }
            await this.query.raw(migration.sql);
            await this.query.raw(INSERT_LEDGER_SQL, [migration.id, checksum]);
            applied.push(migration.id);
        }
        return { applied, skipped };
    }
    validateInput(migrations) {
        if (!Array.isArray(migrations)) {
            throw new Error('MigrationsClient.apply: migrations must be an array of {id, sql}.');
        }
        const seen = new Set();
        for (const migration of migrations) {
            if (!migration || typeof migration.id !== 'string' || migration.id.trim() === '') {
                throw new Error('MigrationsClient.apply: every migration needs a non-empty string "id".');
            }
            if (typeof migration.sql !== 'string' || migration.sql.trim() === '') {
                throw new Error(`MigrationsClient.apply: migration "${migration.id}" needs a non-empty string "sql".`);
            }
            if (seen.has(migration.id)) {
                throw new Error(`MigrationsClient.apply: duplicate migration id "${migration.id}" in the input set.`);
            }
            seen.add(migration.id);
        }
    }
}
exports.MigrationsClient = MigrationsClient;
//# sourceMappingURL=migrations-client.js.map