import { XenitionClient } from '../xenition-client';
import type { User } from '../auth/types';
import { FakeStore, RawHandler } from './fake-store';
/**
 * `@xenition/sdk/testing` — run a generated backend's tests without a
 * network.
 *
 * Nothing in the SDK could be tested offline before this: every module query
 * is an HTTP call to the platform, so a router test either hit a live
 * `api.xenition.com` or mocked the whole client by hand. Neither is a test
 * anyone keeps writing.
 *
 *   import { createTestClient } from '@xenition/sdk/testing';
 *
 *   const { client, store, user } = createTestClient();
 *   const app = new Hono();
 *   app.route('/api', createXenitionApi({ client }));
 *
 *   const res = await app.request('/api/billing/entitlements', {
 *     headers: { Authorization: 'Bearer test' },
 *   });
 *
 * The store is a real in-memory interpreter of the query IR, so rows written
 * by one call are read back by the next — the behaviour under test is the
 * module's, not a stub's.
 */
export { FakeStore, makeFakeContext } from './fake-store';
export type { AggregatePayload, FakeContextOptions, RawHandler } from './fake-store';
export { jobsRawHandler } from './jobs-raw';
export interface TestClientOptions {
    /** The user every token resolves to. Defaults to a stable fake. */
    user?: Partial<User>;
    /**
     * Reject token verification, to exercise the 401 paths.
     */
    unauthenticated?: boolean;
    /** Extra raw-SQL simulation, merged after the built-in jobs and quotas. */
    raw?: RawHandler;
}
export interface TestClient {
    /** Pass to `createXenitionApi({ client })` or any router's options. */
    client: XenitionClient;
    /** The rows behind it — seed state, or assert on what a route wrote. */
    store: FakeStore;
    /** The user every request authenticates as. */
    user: User;
}
/**
 * A client that talks to memory instead of the platform.
 *
 * Only the surfaces a backend test actually drives are wired: the modules,
 * and enough of `auth` for the middleware to resolve a caller. Anything else
 * throws with a message saying so, which is far better than a silently
 * undefined method that fails three frames later.
 */
export declare function createTestClient(options?: TestClientOptions): TestClient;
//# sourceMappingURL=index.d.ts.map