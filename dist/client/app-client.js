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
    /**
     * Send a write (`POST`/`PATCH`/`DELETE`); throws AppClientError on non-2xx
     * (surfacing the 400/409 message). A `body` of `undefined` sends no body /
     * Content-Type — used by DELETE and the body-less `POST /cart`.
     */
    async function sendJson(method, path, body) {
        const init = { method };
        if (body !== undefined) {
            init.headers = { 'Content-Type': 'application/json' };
            init.body = JSON.stringify(body);
        }
        const res = await fetch(url(path), init);
        if (!res.ok)
            throw await (0, errors_1.errorFromResponse)(res);
        return (await res.json());
    }
    /** POST a JSON body; throws AppClientError on non-2xx (surfacing 400 msg). */
    function postJson(path, body) {
        return sendJson('POST', path, body);
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
        booking: {
            async resources(options = {}) {
                const qs = query({ status: options.status });
                const body = await getJson(`/booking/resources${qs}`);
                return body.resources ?? [];
            },
            resource(slug) {
                return getOrNull(`/booking/resources/${encodeURIComponent(slug)}`);
            },
            async slots(slug, range) {
                const qs = query({ from: range.from, to: range.to });
                const body = await getJson(`/booking/resources/${encodeURIComponent(slug)}/slots${qs}`);
                return body.slots ?? [];
            },
            book(slug, input) {
                return postJson(`/booking/resources/${encodeURIComponent(slug)}/bookings`, input);
            },
        },
        media: {
            async albums(options = {}) {
                const qs = query({
                    published: options.published,
                    orderBy: options.orderBy,
                    direction: options.direction,
                    limit: options.limit,
                    offset: options.offset,
                });
                const body = await getJson(`/media/albums${qs}`);
                return body.albums ?? [];
            },
            album(slug) {
                return getOrNull(`/media/albums/${encodeURIComponent(slug)}`);
            },
        },
        catalog: {
            async products(options = {}) {
                const qs = query({
                    collection: options.collection,
                    status: options.status,
                    orderBy: options.orderBy,
                    direction: options.direction,
                    limit: options.limit,
                    offset: options.offset,
                });
                const body = await getJson(`/catalog/products${qs}`);
                return body.products ?? [];
            },
            product(slug) {
                return getOrNull(`/catalog/products/${encodeURIComponent(slug)}`);
            },
            async collections() {
                const body = await getJson(`/catalog/collections`);
                return body.collections ?? [];
            },
            async collectionProducts(slug) {
                const body = await getJson(`/catalog/collections/${encodeURIComponent(slug)}/products`);
                return body.products ?? [];
            },
        },
        inventory: {
            stock(variantId) {
                return getJson(`/inventory/${encodeURIComponent(variantId)}`);
            },
        },
        cart: {
            create() {
                return postJson(`/cart`, {});
            },
            get(token) {
                return getOrNull(`/cart/${encodeURIComponent(token)}`);
            },
            addItem(token, input) {
                return postJson(`/cart/${encodeURIComponent(token)}/items`, input);
            },
            updateItem(token, itemId, input) {
                return sendJson('PATCH', `/cart/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`, input);
            },
            removeItem(token, itemId) {
                return sendJson('DELETE', `/cart/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`);
            },
        },
        orders: {
            get(id) {
                return getOrNull(`/orders/${encodeURIComponent(id)}`);
            },
            byNumber(number, email) {
                const qs = query({ email });
                return getOrNull(`/orders/by-number/${encodeURIComponent(number)}${qs}`);
            },
        },
        checkout: {
            start(cartToken, input) {
                return postJson(`/checkout/${encodeURIComponent(cartToken)}`, input);
            },
            mockComplete(orderId) {
                return postJson(`/checkout/mock/complete`, { orderId });
            },
            order(id) {
                return getOrNull(`/checkout/order/${encodeURIComponent(id)}`);
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