"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsRouter = notificationsRouter;
const hono_1 = require("hono");
const auth_1 = require("./auth");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
const MINUTES_PER_DAY = 1440;
/** UTC-14 … UTC+14, the real span of civil offsets. */
const MAX_OFFSET_MINUTES = 840;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
function notificationsRouter(options = {}) {
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    const resolveClient = (0, client_1.makeClientResolver)('notifications', options.client);
    const inboxOf = (c) => resolveClient(c).modules.notifications;
    const auth = (0, auth_1.requireAuth)({ client: options.client });
    const categories = options.categories && options.categories.length > 0 ? [...options.categories] : ['general'];
    // Reads are unmetered; the three writes are metered like every other
    // write route in this directory. Marking read is cheap but unbounded —
    // an app that polls it in a loop is the shape this dampens.
    if (options.rateLimit !== false) {
        const limit = (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10);
        app.post('/notifications/:id/read', limit);
        app.post('/notifications/read-all', limit);
        app.put('/notifications/preferences', limit);
    }
    /* ── the feed ────────────────────────────────────────────────────────── */
    app.get('/notifications', auth, async (c) => {
        let unreadOnly;
        let limit;
        try {
            unreadOnly = (0, router_utils_1.parseBooleanFlag)('unread', c.req.query('unread'));
            limit = (0, router_utils_1.parseNonNegativeInt)('limit', c.req.query('limit'));
        }
        catch (err) {
            if (err instanceof router_utils_1.QueryParamError)
                return (0, errors_1.badRequest)(c, err.message);
            throw err;
        }
        const category = optionalCategory(c.req.query('category'));
        if (category instanceof Error)
            return (0, errors_1.badRequest)(c, category.message);
        const result = await inboxOf(c).list((0, auth_1.requireUser)(c).id, {
            unreadOnly,
            category,
            // Clamped rather than rejected: a client asking for 5000 rows wants
            // "as many as you'll give me", and a page cap is the server's call.
            limit: Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
            before: c.req.query('before') || undefined,
        });
        return c.json({
            notifications: (0, normalize_1.normalizeRows)(result.notifications),
            nextCursor: result.nextCursor,
        });
    });
    app.get('/notifications/unread-count', auth, async (c) => {
        return c.json({ count: await inboxOf(c).unreadCount((0, auth_1.requireUser)(c).id) });
    });
    /* ── marking read ────────────────────────────────────────────────────── */
    /**
     * Registered before `/notifications/:id/read` for readability rather than
     * necessity — this path is two segments where that one is three, so they
     * cannot collide.
     */
    app.post('/notifications/read-all', auth, async (c) => {
        const inbox = inboxOf(c);
        const userId = (0, auth_1.requireUser)(c).id;
        await inbox.markAllRead(userId);
        // The badge is the thing the caller actually wanted changed, so it
        // comes back here instead of costing a second round trip a moment later.
        return c.json({ read: true, unreadCount: await inbox.unreadCount(userId) });
    });
    app.post('/notifications/:id/read', auth, async (c) => {
        const id = c.req.param('id');
        if (!id)
            return (0, errors_1.badRequest)(c, 'A notification id is required.');
        // `markRead` scopes the UPDATE by user itself, so a stranger's id
        // touches nothing — and reports the same success as a row that was
        // already read. That is the right answer for an idempotent write: it
        // tells the caller nothing about which ids exist.
        await inboxOf(c).markRead((0, auth_1.requireUser)(c).id, id);
        return c.json({ read: true });
    });
    /* ── preferences ─────────────────────────────────────────────────────── */
    app.get('/notifications/preferences', auth, async (c) => {
        const inbox = inboxOf(c);
        const userId = (0, auth_1.requireUser)(c).id;
        // Start from the rows that exist, so a category this app no longer
        // configures does not vanish from a screen that can still switch it
        // back on. Then fill in every configured category with no row from
        // `getPreference`, which answers with the module's own defaults — the
        // reason a fresh account gets switches instead of an empty list.
        const existing = await inbox.listPreferences(userId);
        const missing = categories.filter((name) => !existing.some((preference) => preference.category === name));
        const defaults = await Promise.all(missing.map((name) => inbox.getPreference(userId, name)));
        const preferences = [...existing, ...defaults].sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
        return c.json({ preferences: (0, normalize_1.normalizeRows)(preferences) });
    });
    app.put('/notifications/preferences', auth, async (c) => {
        const inbox = inboxOf(c);
        const userId = (0, auth_1.requireUser)(c).id;
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        /**
         * `PreferencePatch` is mixed-case at the module boundary: `in_app`,
         * `push` and `email` are the column names, while the quiet-hour fields
         * are camelCase. The HTTP body is camelCase throughout — like every
         * other body and every response these routers deal in — and the mapping
         * happens right here, so the shape a client sends matches the shape it
         * reads back from `GET /preferences`.
         *
         * `undefined` means "leave it alone" and `null` means "clear it". The
         * module distinguishes the two, so neither is collapsed on the way in.
         */
        let patch;
        try {
            patch = {
                in_app: flag(body.inApp, 'inApp'),
                push: flag(body.push, 'push'),
                email: flag(body.email, 'email'),
                quietStartMinute: minute(body.quietStartMinute, 'quietStartMinute'),
                quietEndMinute: minute(body.quietEndMinute, 'quietEndMinute'),
                utcOffsetMinutes: offset(body.utcOffsetMinutes, 'utcOffsetMinutes'),
            };
        }
        catch (err) {
            if (err instanceof router_utils_1.QueryParamError)
                return (0, errors_1.badRequest)(c, err.message);
            throw err;
        }
        const target = optionalCategory(body.category);
        if (target instanceof Error)
            return (0, errors_1.badRequest)(c, target.message);
        // Preferences are stored per category. A settings screen with one
        // quiet-hours control means "quiet everywhere", so an omitted category
        // writes the patch to every configured category — otherwise a user
        // would silence reminders and still be woken by a billing alert.
        const written = await Promise.all((target ? [target] : categories).map((name) => inbox.setPreference(userId, name, patch)));
        return c.json({ preferences: (0, normalize_1.normalizeRows)(written) });
    });
    return app;
}
/* ── helpers ───────────────────────────────────────────────────────────── */
/**
 * Validation failures reuse `QueryParamError` — it is this directory's
 * "the caller sent something we cannot use", and the routes above turn it
 * into a 400 with the offending field named.
 */
function flag(value, field) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'boolean') {
        throw new router_utils_1.QueryParamError(`"${field}" must be true or false.`);
    }
    return value;
}
/**
 * A minute of the local day, `null` to clear the window, or `undefined` to
 * leave it as it was — the module distinguishes all three, so this does too.
 *
 * Checked here as well as in the module so a bad value is a 400 naming the
 * field rather than whatever a module-level failure happens to map to.
 */
function minute(value, field) {
    if (value === undefined)
        return undefined;
    if (value === null || value === '')
        return null;
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= MINUTES_PER_DAY) {
        throw new router_utils_1.QueryParamError(`"${field}" must be a whole number of minutes from 0 to ${MINUTES_PER_DAY - 1}.`);
    }
    return n;
}
/** Minutes to ADD to UTC to get the caller's local time. */
function offset(value, field) {
    if (value === undefined || value === null)
        return undefined;
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' ||
        !Number.isInteger(n) ||
        n < -MAX_OFFSET_MINUTES ||
        n > MAX_OFFSET_MINUTES) {
        throw new router_utils_1.QueryParamError(`"${field}" must be minutes between -${MAX_OFFSET_MINUTES} and ${MAX_OFFSET_MINUTES}.`);
    }
    return n;
}
/**
 * A category name, or undefined when absent. Returns the Error rather than
 * throwing it so the caller can answer 400 inline — categories arrive from
 * both a query string and a body, and one shape covers both.
 */
function optionalCategory(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string' || value.length > 60) {
        return new Error('"category" must be a string of at most 60 characters.');
    }
    return value.trim();
}
/** A JSON object body, or undefined for anything else (array/scalar/invalid). */
async function readObjectBody(c) {
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return undefined;
    return body;
}
//# sourceMappingURL=notifications-router.js.map