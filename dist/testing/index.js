"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobsRawHandler = exports.makeFakeContext = exports.FakeStore = void 0;
exports.createTestClient = createTestClient;
const errors_1 = require("../core/errors");
const billing_1 = require("../modules/billing");
const jobs_1 = require("../modules/jobs");
const notifications_1 = require("../modules/notifications");
const quotas_1 = require("../modules/quotas");
const cms_1 = require("../modules/cms");
const forms_1 = require("../modules/forms");
const reviews_1 = require("../modules/reviews");
const fake_store_1 = require("./fake-store");
const jobs_raw_1 = require("./jobs-raw");
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
var fake_store_2 = require("./fake-store");
Object.defineProperty(exports, "FakeStore", { enumerable: true, get: function () { return fake_store_2.FakeStore; } });
Object.defineProperty(exports, "makeFakeContext", { enumerable: true, get: function () { return fake_store_2.makeFakeContext; } });
var jobs_raw_2 = require("./jobs-raw");
Object.defineProperty(exports, "jobsRawHandler", { enumerable: true, get: function () { return jobs_raw_2.jobsRawHandler; } });
const DEFAULT_USER = {
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
function createTestClient(options = {}) {
    const user = { ...DEFAULT_USER, ...options.user };
    const raw = (sql, params, store) => {
        if (options.raw) {
            try {
                return options.raw(sql, params, store);
            }
            catch {
                // Fall through to the built-ins rather than failing outright — a
                // caller's handler only needs to cover its own statements.
            }
        }
        return (0, jobs_raw_1.jobsRawHandler)(sql, params, store);
    };
    const { store, ctx } = (0, fake_store_1.makeFakeContext)({ raw });
    const modules = buildModules(ctx);
    const verifyToken = async (token) => {
        if (options.unauthenticated) {
            throw new errors_1.XenitionError('AUTH_INVALID_TOKEN', 'Test client is unauthenticated.');
        }
        if (!token)
            throw new errors_1.XenitionError('AUTH_INVALID_TOKEN', 'No token.');
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
                expiresAt: Date.now() + 3600000,
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
            throw new Error('createTestClient: transactions are not simulated. Assert on the individual ' +
                'statements, or drive the module method that wraps them.');
        },
    };
    return { client, store, user };
}
/**
 * Instantiate every module over one shared context.
 *
 * Eagerly rather than lazily: a test that forgets `enable()` should still
 * work, since the point here is to remove ceremony, and there is no DDL to
 * run against memory.
 */
function buildModules(ctx) {
    return {
        billing: new billing_1.BillingClient(ctx),
        jobs: new jobs_1.JobsClient(ctx),
        notifications: new notifications_1.NotificationsClient(ctx),
        quotas: new quotas_1.QuotasClient(ctx),
        cms: new cms_1.CmsClient(ctx),
        forms: new forms_1.FormsClient(ctx),
        reviews: new reviews_1.ReviewsClient(ctx),
    };
}
//# sourceMappingURL=index.js.map