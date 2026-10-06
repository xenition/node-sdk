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
import { isExpoPushToken } from '../push/expo-token';
import type { PushDevice, RegisterDeviceInput, SendPushInput, SendPushResult } from '../push/types';

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
  /**
   * What `client.push` was asked to do. Devices are keyed by token, like the
   * platform; `sent` holds every `push.send()` input in order.
   */
  push: { devices: Map<string, PushDevice>; sent: SendPushInput[] };
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
 * enough of `auth` for the middleware to resolve a caller, and an in-memory
 * `push`. Anything else throws with a message saying so, which is far better
 * than a silently undefined method that fails three frames later.
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

  const push = { devices: new Map<string, PushDevice>(), sent: [] as SendPushInput[] };

  const client = {
    push: {
      registerDevice: async (input: RegisterDeviceInput): Promise<PushDevice> => {
        const device: PushDevice = {
          id: input.token,
          userId: input.userId ?? user.id,
          token: input.token,
          platform: isExpoPushToken(input.token) ? 'expo' : input.platform,
          deviceName: input.deviceName ?? null,
          active: true,
          createdAt: new Date().toISOString(),
        };
        push.devices.set(input.token, device);
        return device;
      },
      unregisterDevice: async (token: string): Promise<void> => {
        push.devices.delete(token);
      },
      send: async (input: SendPushInput): Promise<SendPushResult> => {
        push.sent.push(input);
        const targets = Array.isArray(input.targets) ? input.targets : [input.targets];
        const hit = [...push.devices.values()].filter((d) =>
          targets.some(
            (t) =>
              ('userId' in t && t.userId === d.userId) ||
              ('token' in t && t.token === d.token) ||
              ('deviceIds' in t && t.deviceIds.includes(d.id)),
          ),
        );
        return {
          sent: hit.length,
          failed: 0,
          skipped: 0,
          results: hit.map((d) => ({ deviceId: d.id, platform: d.platform, status: 'sent' as const })),
        };
      },
    },
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

  return { client, store, user, push };
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
