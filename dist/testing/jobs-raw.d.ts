import { FakeStore } from './fake-store';
/**
 * Simulates the two raw statements `JobsClient` issues — the claim UPDATE
 * and the purge DELETE — against the fake store's in-memory rows.
 *
 * The builder IR can be interpreted generically; SQL cannot. Rather than
 * stub `claim()` away (which would leave the queue's actual rules untested),
 * this mirrors the real statements' WHERE clauses so what is due, what a
 * lease protects and what a second worker sees are all exercised. If those
 * clauses change in jobs-client.ts, this has to change with them.
 */
export declare const jobsRawHandler: (sql: string, params: unknown[], store: FakeStore) => Record<string, unknown>[];
//# sourceMappingURL=jobs-raw.d.ts.map