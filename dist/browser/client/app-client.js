"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAppClient = createAppClient;
const errors_1 = require("./errors");
/**
 * `@xenition/sdk/client` — a framework-agnostic browser/worker data client
 * for a generated app's OWN backend.
 *
 * Templates render as static frontends whose backend mounts the
 * `@xenition/sdk/hono` routers (which hold the platform SERVICE key). This
 * client talks ONLY to that backend over the global `fetch` — it carries NO
 * key, no axios, and no node builtins, so it is safe to bundle into any
 * browser/worker frontend. It mirrors the router contract 1:1 and returns
 * the camelCase shapes declared in ./types.
 *
 *   import { createAppClient } from '@xenition/sdk/client';
 *   const api = createAppClient(`${import.meta.env.VITE_API_URL ?? ''}/api`);
 *   const posts = await api.cms.items('posts', { orderBy: 'created_at', direction: 'DESC' });
 *
 * Error contract:
 *   - single-get (cms.page/cms.item, listings.get, events.get) → 404 is null
 *   - every other non-2xx throws `AppClientError(status, code?, message)`
 *     (POST validation 400s surface the server's message).
 */
function createAppClient(baseUrl) {
    const base = baseUrl.replace(/\/+$/, '');
    const url = (path) => `${base}${path}`;
    /** GET expecting JSON; throws AppClientError on any non-2xx (incl. 404). */
    async function getJson(path) {
        const res = await fetch(url(path));
        if (!res.ok)
            throw await (0, errors_1.errorFromResponse)(res);
        return (await res.json());
    }
    /** GET a single resource; 404 collapses to null, other non-2xx throw. */
    async function getOrNull(path) {
        const res = await fetch(url(path));
        if (res.status === 404)
            return null;
        if (!res.ok)
            throw await (0, errors_1.errorFromResponse)(res);
        return (await res.json());
    }
    /** POST a JSON body; throws AppClientError on non-2xx (surfacing 400 msg). */
    async function postJson(path, body) {
        const res = await fetch(url(path), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw await (0, errors_1.errorFromResponse)(res);
        return (await res.json());
    }
    return {
        cms: {
            page(slug) {
                return getOrNull(`/cms/pages/${encodeURIComponent(slug)}`);
            },
            async items(collectionKey, options = {}) {
                const qs = query({
                    published: options.published,
                    orderBy: options.orderBy,
                    direction: options.direction,
                    limit: options.limit,
                    offset: options.offset,
                });
                const body = await getJson(`/cms/collections/${encodeURIComponent(collectionKey)}/items${qs}`);
                return body.items ?? [];
            },
            item(collectionKey, slug) {
                return getOrNull(`/cms/collections/${encodeURIComponent(collectionKey)}/items/${encodeURIComponent(slug)}`);
            },
        },
        listings: {
            async list(options = {}) {
                const qs = query({
                    category: options.category,
                    status: options.status,
                    featured: options.featured,
                    orderBy: options.orderBy,
                    direction: options.direction,
                    limit: options.limit,
                    offset: options.offset,
                });
                const body = await getJson(`/listings${qs}`);
                return body.listings ?? [];
            },
            get(slug) {
                return getOrNull(`/listings/${encodeURIComponent(slug)}`);
            },
            async categories() {
                const body = await getJson(`/listings/meta/categories`);
                return body.categories ?? [];
            },
            submit(input) {
                return postJson(`/listings`, input);
            },
        },
        events: {
            async list(options = {}) {
                const qs = query({
                    when: options.when,
                    status: options.status,
                    limit: options.limit,
                    offset: options.offset,
                });
                const body = await getJson(`/events${qs}`);
                return body.events ?? [];
            },
            get(slug) {
                return getOrNull(`/events/${encodeURIComponent(slug)}`);
            },
            rsvp(slug, input) {
                return postJson(`/events/${encodeURIComponent(slug)}/rsvps`, input);
            },
        },
        forms: {
            schema(key) {
                return getJson(`/forms/${encodeURIComponent(key)}`);
            },
            submit(key, data) {
                return postJson(`/forms/${encodeURIComponent(key)}/submissions`, data);
            },
        },
        reviews: {
            list(targetType, targetId) {
                return getJson(`/reviews/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`);
            },
            submit(targetType, targetId, input) {
                return postJson(`/reviews/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`, input);
            },
        },
    };
}
/**
 * Build a `?a=1&b=2` query string from a param map, skipping `undefined`
 * values. Booleans become the router's `1`/`0` flags; numbers stringify.
 * Returns '' when nothing is set.
 */
function query(params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined)
            continue;
        qs.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
}
//# sourceMappingURL=app-client.js.map