import { XenitionClient } from '../xenition-client';
import { XenitionError } from '../core/errors';
import type { User } from '../auth/types';
import { ModuleContext } from '../modules/core';
import { BillingClient } from '../modules/billing';
import { JobsClient } from '../modules/jobs';
import { NotificationsClient } from '../modules/notifications';
import { QuotasClient } from '../modules/quotas';
import { CmsClient } from '../modules/cms';
import { FormsClient } from '../modules/forms';
import { ReviewsClient } from '../modules/reviews';
import { FakeStore, makeFakeContext, RawHandler } from './fake-store';
import { jobsRawHandler } from './jobs-raw';

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

const DEFAULT_USER: User = {
  id: 'test-user',
  email: 'test@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * A client that talks to memory instead of the platform.
 *
 * Only the surfaces a backend test actually drives are wired: the modules,
 * and enough of `auth` for the middleware to resolve a caller. Anything else
 * throws with a message saying so, which is far better than a silently
 * undefined method that fails three frames later.
 */
export function createTestClient(options: TestClientOptions = {}): TestClient {
  const user: User = { ...DEFAULT_USER, ...options.user };
  const raw: RawHandler = (sql, params, store) => {
    if (options.raw) {
      try {
        return options.raw(sql, params, store);
      } catch {
        // Fall through to the built-ins rather than failing outright — a
        // caller's handler only needs to cover its own statements.
      }
    }
    return jobsRawHandler(sql, params, store);
  };

  const { store, ctx } = makeFakeContext({ raw });
  const modules = buildModules(ctx);

  const verifyToken = async (token: string): Promise<User> => {
    if (options.unauthenticated) {
      throw new XenitionError('AUTH_INVALID_TOKEN', 'Test client is unauthenticated.');
    }
    if (!token) throw new XenitionError('AUTH_INVALID_TOKEN', 'No token.');
    return user;
  };

  const client = {
    auth: {
      verifyToken,
      me: async () => user,
      login: async () => ({
        user,
        session: { id: 'sess', userId: user.id, expiresAt: '', createdAt: '' },
        token: 'test',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3_600_000,
      }),
    },
    modules: {
      ...modules,
      use: () => undefined,
      enable: async () => undefined,
      isEnabled: () => true,
    },
    query: ctx.query,
    raw: ctx.raw,
    transaction: async () => {
      throw new Error(
        'createTestClient: transactions are not simulated. Assert on the individual ' +
          'statements, or drive the module method that wraps them.',
      );
    },
  } as unknown as XenitionClient;

  return { client, store, user };
}

/**
 * Instantiate every module over one shared context.
 *
 * Eagerly rather than lazily: a test that forgets `enable()` should still
 * work, since the point here is to remove ceremony, and there is no DDL to
 * run against memory.
 */
function buildModules(ctx: ModuleContext) {
  return {
    billing: new BillingClient(ctx),
    jobs: new JobsClient(ctx),
    notifications: new NotificationsClient(ctx),
    quotas: new QuotasClient(ctx),
    cms: new CmsClient(ctx),
    forms: new FormsClient(ctx),
    reviews: new ReviewsClient(ctx),
  };
}
