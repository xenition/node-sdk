import { FakeStore } from './fake-store';
import { JOBS_TABLE } from '../modules/jobs';
import type { Job } from '../modules/jobs';

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
export const jobsRawHandler = (
  sql: string,
  params: unknown[],
  store: FakeStore,
): Record<string, unknown>[] => {
  const rows = store.rows(JOBS_TABLE) as unknown as Job[];
  const now = Date.now();

  if (sql.startsWith('UPDATE')) {
    const [claimedBy, leaseSeconds, limit, types] = params as [string, number, number, string[]?];
    const due = rows
      .filter((job) => {
        const ready =
          (job.status === 'queued' || job.status === 'failed') && Date.parse(job.run_at) <= now;
        const stale =
          job.status === 'running' &&
          job.lease_expires_at !== null &&
          Date.parse(job.lease_expires_at) < now;
        if (!ready && !stale) return false;
        return !types || types.includes(job.type);
      })
      .sort((a, b) => Date.parse(a.run_at) - Date.parse(b.run_at))
      .slice(0, limit);

    for (const job of due) {
      job.status = 'running';
      job.attempts += 1;
      job.claimed_at = new Date(now).toISOString();
      job.claimed_by = claimedBy;
      job.lease_expires_at = new Date(now + leaseSeconds * 1000).toISOString();
    }
    return due.map((job) => ({ ...job })) as unknown as Record<string, unknown>[];
  }

  if (sql.startsWith('DELETE')) {
    const [cutoff] = params as [string];
    const doomed = rows.filter(
      (job) => job.status === 'succeeded' && Date.parse(job.updated_at) < Date.parse(cutoff),
    );
    store.tables.set(
      JOBS_TABLE,
      rows.filter((job) => !doomed.includes(job)) as unknown as Record<string, unknown>[],
    );
    return doomed.map((job) => ({ id: job.id }));
  }

  throw new Error(`jobsRawHandler: unexpected SQL: ${sql.slice(0, 60)}`);
};
