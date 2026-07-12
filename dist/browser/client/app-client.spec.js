"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_client_1 = require("./app-client");
const errors_1 = require("./errors");
const format_1 = require("./format");
let fetchMock;
/** A minimal `Response`-like for a JSON 2xx. */
function jsonOk(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}
/** A `Response`-like for an error status carrying the router error body. */
function jsonErr(status, code, message) {
    return {
        ok: false,
        status,
        json: async () => (code || message ? { error: { code, message } } : {}),
    };
}
/** The single URL the mock was called with. */
function calledUrl() {
    return fetchMock.mock.calls[0][0];
}
/** The RequestInit the mock was called with (for POST assertions). */
function calledInit() {
    return fetchMock.mock.calls[0][1];
}
beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
});
const api = () => (0, app_client_1.createAppClient)('/api');
describe('baseUrl handling', () => {
    it('joins path onto the base', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        await (0, app_client_1.createAppClient)('/api').cms.page('x');
        expect(calledUrl()).toBe('/api/cms/pages/x');
    });
    it('strips a trailing slash from the base', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        await (0, app_client_1.createAppClient)('https://app.example.com/api/').cms.page('x');
        expect(calledUrl()).toBe('https://app.example.com/api/cms/pages/x');
    });
    it('works with an empty base (relative)', async () => {
        fetchMock.mockResolvedValue(jsonOk({ items: [] }));
        await (0, app_client_1.createAppClient)('').cms.items('posts');
        expect(calledUrl()).toBe('/cms/collections/posts/items');
    });
});
describe('cms.page', () => {
    it('GETs the page route and returns the camelCase body', async () => {
        const page = { id: '1', slug: 'about', title: 'About', bodyHtml: '<p>hi</p>', seo: {}, published: true, sort: 0, createdAt: 'a', updatedAt: 'b' };
        fetchMock.mockResolvedValue(jsonOk(page));
        const result = await api().cms.page('about');
        expect(calledUrl()).toBe('/api/cms/pages/about');
        expect(result).toEqual(page);
        // camelCase passthrough — bodyHtml stays bodyHtml
        expect(result?.bodyHtml).toBe('<p>hi</p>');
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404, 'NOT_FOUND'));
        expect(await api().cms.page('missing')).toBeNull();
    });
    it('encodes the slug', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        await api().cms.page('a b/c');
        expect(calledUrl()).toBe('/api/cms/pages/a%20b%2Fc');
    });
    it('throws AppClientError on a 500', async () => {
        fetchMock.mockResolvedValue(jsonErr(500, 'INTERNAL', 'Internal error.'));
        await expect(api().cms.page('x')).rejects.toBeInstanceOf(errors_1.AppClientError);
    });
});
describe('cms.items', () => {
    it('unwraps the { items } envelope with no options', async () => {
        fetchMock.mockResolvedValue(jsonOk({ items: [{ id: '1' }] }));
        const items = await api().cms.items('posts');
        expect(calledUrl()).toBe('/api/cms/collections/posts/items');
        expect(items).toHaveLength(1);
    });
    it('builds every query param (booleans → 1/0)', async () => {
        fetchMock.mockResolvedValue(jsonOk({ items: [] }));
        await api().cms.items('posts', { published: true, orderBy: 'created_at', direction: 'DESC', limit: 5, offset: 10 });
        expect(calledUrl()).toBe('/api/cms/collections/posts/items?published=1&orderBy=created_at&direction=DESC&limit=5&offset=10');
    });
    it('encodes published:false as 0', async () => {
        fetchMock.mockResolvedValue(jsonOk({ items: [] }));
        await api().cms.items('posts', { published: false });
        expect(calledUrl()).toBe('/api/cms/collections/posts/items?published=0');
    });
    it('returns [] when the envelope is empty', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        expect(await api().cms.items('posts')).toEqual([]);
    });
});
describe('cms.item', () => {
    it('GETs the nested item route', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: '1', slug: 'p' }));
        const item = await api().cms.item('posts', 'p');
        expect(calledUrl()).toBe('/api/cms/collections/posts/items/p');
        expect(item?.id).toBe('1');
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().cms.item('posts', 'nope')).toBeNull();
    });
});
describe('listings.list', () => {
    it('unwraps { listings } and builds params', async () => {
        fetchMock.mockResolvedValue(jsonOk({ listings: [{ id: '1' }] }));
        const rows = await api().listings.list({ category: 'jobs', featured: true, status: 'published', limit: 3 });
        expect(calledUrl()).toBe('/api/listings?category=jobs&status=published&featured=1&limit=3');
        expect(rows).toHaveLength(1);
    });
    it('has no query string with no options', async () => {
        fetchMock.mockResolvedValue(jsonOk({ listings: [] }));
        await api().listings.list();
        expect(calledUrl()).toBe('/api/listings');
    });
});
describe('listings.get', () => {
    it('returns the listing', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: '1', slug: 'a-flat' }));
        const l = await api().listings.get('a-flat');
        expect(calledUrl()).toBe('/api/listings/a-flat');
        expect(l?.slug).toBe('a-flat');
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().listings.get('gone')).toBeNull();
    });
});
describe('listings.categories', () => {
    it('unwraps { categories }', async () => {
        fetchMock.mockResolvedValue(jsonOk({ categories: ['jobs', 'flats'] }));
        const cats = await api().listings.categories();
        expect(calledUrl()).toBe('/api/listings/meta/categories');
        expect(cats).toEqual(['jobs', 'flats']);
    });
});
describe('listings.submit', () => {
    it('POSTs the input body and returns {id, slug, status}', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: '9', slug: 'a-job', status: 'pending' }, 201));
        const input = { category: 'jobs', title: 'A job', summary: 's' };
        const res = await api().listings.submit(input);
        expect(calledUrl()).toBe('/api/listings');
        const init = calledInit();
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual(input);
        expect(res).toEqual({ id: '9', slug: 'a-job', status: 'pending' });
    });
    it('surfaces the server 400 validation message', async () => {
        fetchMock.mockResolvedValue(jsonErr(400, 'VALIDATION_ERROR', 'title is required'));
        await expect(api().listings.submit({ category: 'x', title: '' })).rejects.toMatchObject({
            status: 400,
            code: 'VALIDATION_ERROR',
            message: 'title is required',
        });
    });
});
describe('events.list', () => {
    it('unwraps { events } and builds when/status/limit/offset', async () => {
        fetchMock.mockResolvedValue(jsonOk({ events: [{ id: '1' }] }));
        await api().events.list({ when: 'upcoming', status: 'published', limit: 2, offset: 4 });
        expect(calledUrl()).toBe('/api/events?when=upcoming&status=published&limit=2&offset=4');
    });
    it('hits /events with no query when no options', async () => {
        fetchMock.mockResolvedValue(jsonOk({ events: [] }));
        await api().events.list();
        expect(calledUrl()).toBe('/api/events');
    });
});
describe('events.get', () => {
    it('returns the event with counts', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: '1', slug: 'party', confirmedCount: 3, waitlistCount: 0, spotsLeft: 7 }));
        const e = await api().events.get('party');
        expect(calledUrl()).toBe('/api/events/party');
        expect(e?.confirmedCount).toBe(3);
        expect(e?.spotsLeft).toBe(7);
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().events.get('nope')).toBeNull();
    });
});
describe('events.rsvp', () => {
    it('POSTs the rsvp body and returns {id, status}', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 'r1', status: 'confirmed' }, 201));
        const res = await api().events.rsvp('party', { name: 'Ada', email: 'a@b.co', partySize: 2 });
        expect(calledUrl()).toBe('/api/events/party/rsvps');
        const init = calledInit();
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ name: 'Ada', email: 'a@b.co', partySize: 2 });
        expect(res).toEqual({ id: 'r1', status: 'confirmed' });
    });
});
describe('forms.schema', () => {
    it('GETs the form and returns the schema', async () => {
        const form = { id: '1', key: 'contact', name: 'Contact', fields: [{ name: 'email', type: 'email' }], createdAt: 'a', updatedAt: 'b' };
        fetchMock.mockResolvedValue(jsonOk(form));
        const schema = await api().forms.schema('contact');
        expect(calledUrl()).toBe('/api/forms/contact');
        expect(schema.fields[0].name).toBe('email');
    });
    it('THROWS on 404 (schema is not nullable)', async () => {
        fetchMock.mockResolvedValue(jsonErr(404, 'NOT_FOUND', 'Route not found.'));
        await expect(api().forms.schema('nope')).rejects.toBeInstanceOf(errors_1.AppClientError);
    });
});
describe('forms.submit', () => {
    it('POSTs the data to /forms/:key/submissions and returns {id}', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 's1' }, 201));
        const data = { email: 'a@b.co', message: 'hi' };
        const res = await api().forms.submit('contact', data);
        expect(calledUrl()).toBe('/api/forms/contact/submissions');
        expect(JSON.parse(calledInit().body)).toEqual(data);
        expect(res).toEqual({ id: 's1' });
    });
});
describe('reviews.list', () => {
    it('GETs the target route and returns {reviews, aggregate}', async () => {
        const body = { reviews: [{ id: '1', authorName: 'Ada', rating: 5 }], aggregate: { count: 1, average: 5 } };
        fetchMock.mockResolvedValue(jsonOk(body));
        const res = await api().reviews.list('product', 'sku-1');
        expect(calledUrl()).toBe('/api/reviews/product/sku-1');
        expect(res.aggregate).toEqual({ count: 1, average: 5 });
        expect(res.reviews[0].authorName).toBe('Ada');
    });
    it('encodes target segments', async () => {
        fetchMock.mockResolvedValue(jsonOk({ reviews: [], aggregate: { count: 0, average: null } }));
        await api().reviews.list('a/b', 'x y');
        expect(calledUrl()).toBe('/api/reviews/a%2Fb/x%20y');
    });
});
describe('reviews.submit', () => {
    it('POSTs the input and returns {id, status}', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 'rv1', status: 'pending' }, 201));
        const input = { authorName: 'Ada', rating: 4, title: 'Nice', body: 'Good' };
        const res = await api().reviews.submit('product', 'sku-1', input);
        expect(calledUrl()).toBe('/api/reviews/product/sku-1');
        expect(JSON.parse(calledInit().body)).toEqual(input);
        expect(res).toEqual({ id: 'rv1', status: 'pending' });
    });
});
/* ============================ booking ============================ */
describe('booking.resources', () => {
    it('unwraps { resources } and passes the status filter', async () => {
        fetchMock.mockResolvedValue(jsonOk({ resources: [{ id: '1', slotMinutes: 30 }] }));
        const rows = await api().booking.resources({ status: 'all' });
        expect(calledUrl()).toBe('/api/booking/resources?status=all');
        expect(rows).toHaveLength(1);
        // camelCase passthrough — slotMinutes stays slotMinutes
        expect(rows[0].slotMinutes).toBe(30);
    });
    it('has no query string with no options and returns [] when empty', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        const rows = await api().booking.resources();
        expect(calledUrl()).toBe('/api/booking/resources');
        expect(rows).toEqual([]);
    });
});
describe('booking.resource', () => {
    it('GETs the resource route and returns it', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: '1', slug: 'chair-1', maxAdvanceDays: 60 }));
        const r = await api().booking.resource('chair-1');
        expect(calledUrl()).toBe('/api/booking/resources/chair-1');
        expect(r?.maxAdvanceDays).toBe(60);
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().booking.resource('nope')).toBeNull();
    });
});
describe('booking.slots', () => {
    it('unwraps { slots } and builds from/to', async () => {
        fetchMock.mockResolvedValue(jsonOk({ slots: [{ startsAt: 'a', endsAt: 'b', spotsLeft: 2 }] }));
        const slots = await api().booking.slots('chair-1', { from: '2026-07-01', to: '2026-07-08' });
        expect(calledUrl()).toBe('/api/booking/resources/chair-1/slots?from=2026-07-01&to=2026-07-08');
        expect(slots[0].spotsLeft).toBe(2);
    });
    it('returns [] when the envelope is empty', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        expect(await api().booking.slots('chair-1', { from: 'a', to: 'b' })).toEqual([]);
    });
});
describe('booking.book', () => {
    it('POSTs the booking body and returns {id, startsAt, status}', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 'bk1', startsAt: 'a', status: 'confirmed' }, 201));
        const input = { startsAt: 'a', customerName: 'Ada', customerEmail: 'a@b.co', partySize: 2, notes: 'hi' };
        const res = await api().booking.book('chair-1', input);
        expect(calledUrl()).toBe('/api/booking/resources/chair-1/bookings');
        const init = calledInit();
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual(input);
        expect(res).toEqual({ id: 'bk1', startsAt: 'a', status: 'confirmed' });
    });
    it('surfaces a 409 SLOT_UNAVAILABLE as AppClientError', async () => {
        fetchMock.mockResolvedValue(jsonErr(409, 'SLOT_UNAVAILABLE', 'That slot was just taken.'));
        await expect(api().booking.book('chair-1', { startsAt: 'a', customerName: 'Ada', customerEmail: 'a@b.co' })).rejects.toMatchObject({ status: 409, code: 'SLOT_UNAVAILABLE', message: 'That slot was just taken.' });
    });
});
/* ============================= media ============================= */
describe('media.albums', () => {
    it('unwraps { albums } and builds every query param', async () => {
        fetchMock.mockResolvedValue(jsonOk({ albums: [{ id: '1', coverUrl: null }] }));
        await api().media.albums({ published: true, orderBy: 'sort', direction: 'ASC', limit: 5, offset: 10 });
        expect(calledUrl()).toBe('/api/media/albums?published=1&orderBy=sort&direction=ASC&limit=5&offset=10');
    });
    it('has no query string with no options and returns [] when empty', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        const albums = await api().media.albums();
        expect(calledUrl()).toBe('/api/media/albums');
        expect(albums).toEqual([]);
    });
});
describe('media.album', () => {
    it('GETs the album and returns it merged with items', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: '1', slug: 'trip', coverUrl: 'u', items: [{ id: 'i1', albumId: '1' }] }));
        const album = await api().media.album('trip');
        expect(calledUrl()).toBe('/api/media/albums/trip');
        expect(album?.coverUrl).toBe('u');
        expect(album?.items[0].albumId).toBe('1');
    });
    it('returns null on 404 (unknown/unpublished)', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().media.album('gone')).toBeNull();
    });
});
/* ============================ catalog ============================ */
describe('catalog.products', () => {
    it('unwraps { products } and builds collection/status/limit/offset', async () => {
        fetchMock.mockResolvedValue(jsonOk({ products: [{ id: '1', collectionId: null }] }));
        const rows = await api().catalog.products({ collection: 'shoes', status: 'all', limit: 4, offset: 8 });
        expect(calledUrl()).toBe('/api/catalog/products?collection=shoes&status=all&limit=4&offset=8');
        expect(rows[0].collectionId).toBeNull();
    });
    it('has no query string with no options and returns [] when empty', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        const rows = await api().catalog.products();
        expect(calledUrl()).toBe('/api/catalog/products');
        expect(rows).toEqual([]);
    });
});
describe('catalog.product', () => {
    it('GETs the product and returns it with variants (camelCase money)', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: '1', slug: 't', variants: [{ id: 'v1', priceCents: 1999 }] }));
        const p = await api().catalog.product('t');
        expect(calledUrl()).toBe('/api/catalog/products/t');
        expect(p?.variants[0].priceCents).toBe(1999);
    });
    it('returns null on 404 (unknown/draft)', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().catalog.product('draft')).toBeNull();
    });
});
describe('catalog.collections', () => {
    it('unwraps { collections }', async () => {
        fetchMock.mockResolvedValue(jsonOk({ collections: [{ id: '1', slug: 'shoes' }] }));
        const cols = await api().catalog.collections();
        expect(calledUrl()).toBe('/api/catalog/collections');
        expect(cols[0].slug).toBe('shoes');
    });
    it('returns [] when the envelope is empty', async () => {
        fetchMock.mockResolvedValue(jsonOk({}));
        expect(await api().catalog.collections()).toEqual([]);
    });
});
describe('catalog.collectionProducts', () => {
    it('unwraps { products } from the collection route', async () => {
        fetchMock.mockResolvedValue(jsonOk({ collection: { id: 'c1' }, products: [{ id: 'p1' }] }));
        const rows = await api().catalog.collectionProducts('shoes');
        expect(calledUrl()).toBe('/api/catalog/collections/shoes/products');
        expect(rows).toHaveLength(1);
    });
    it('throws AppClientError on 404 (unknown collection)', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        await expect(api().catalog.collectionProducts('nope')).rejects.toBeInstanceOf(errors_1.AppClientError);
    });
});
/* =========================== inventory =========================== */
describe('inventory.stock', () => {
    it('GETs the variant route and returns the derived view', async () => {
        fetchMock.mockResolvedValue(jsonOk({ variantId: 'v1', quantity: 10, reserved: 3, available: 7, policy: 'deny' }));
        const stock = await api().inventory.stock('v1');
        expect(calledUrl()).toBe('/api/inventory/v1');
        expect(stock.available).toBe(7);
        expect(stock.policy).toBe('deny');
    });
    it('throws AppClientError on a 500', async () => {
        fetchMock.mockResolvedValue(jsonErr(500));
        await expect(api().inventory.stock('v1')).rejects.toBeInstanceOf(errors_1.AppClientError);
    });
});
/* ============================= cart ============================= */
describe('cart.create', () => {
    it('POSTs /cart with an empty body and returns { token }', async () => {
        fetchMock.mockResolvedValue(jsonOk({ token: 'tok-1' }, 201));
        const res = await api().cart.create();
        expect(calledUrl()).toBe('/api/cart');
        const init = calledInit();
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({});
        expect(res).toEqual({ token: 'tok-1' });
    });
});
describe('cart.get', () => {
    it('GETs the cart view for a token', async () => {
        fetchMock.mockResolvedValue(jsonOk({ token: 'tok', currency: 'USD', items: [], subtotalCents: 0 }));
        const cart = await api().cart.get('tok');
        expect(calledUrl()).toBe('/api/cart/tok');
        expect(cart?.subtotalCents).toBe(0);
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().cart.get('gone')).toBeNull();
    });
});
describe('cart.addItem', () => {
    it('POSTs {variantId, quantity} and returns the updated cart', async () => {
        fetchMock.mockResolvedValue(jsonOk({ token: 'tok', currency: 'USD', items: [{ id: 'i1', lineTotalCents: 1999 }], subtotalCents: 1999 }));
        const res = await api().cart.addItem('tok', { variantId: 'v1', quantity: 1 });
        expect(calledUrl()).toBe('/api/cart/tok/items');
        const init = calledInit();
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ variantId: 'v1', quantity: 1 });
        expect(res.subtotalCents).toBe(1999);
    });
});
describe('cart.updateItem', () => {
    it('PATCHes the item with {quantity} and returns the updated cart', async () => {
        fetchMock.mockResolvedValue(jsonOk({ token: 'tok', currency: 'USD', items: [], subtotalCents: 0 }));
        await api().cart.updateItem('tok', 'i1', { quantity: 3 });
        expect(calledUrl()).toBe('/api/cart/tok/items/i1');
        const init = calledInit();
        expect(init.method).toBe('PATCH');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ quantity: 3 });
    });
});
describe('cart.removeItem', () => {
    it('DELETEs the item with no body and returns the updated cart', async () => {
        fetchMock.mockResolvedValue(jsonOk({ token: 'tok', currency: 'USD', items: [], subtotalCents: 0 }));
        await api().cart.removeItem('tok', 'i1');
        expect(calledUrl()).toBe('/api/cart/tok/items/i1');
        const init = calledInit();
        expect(init.method).toBe('DELETE');
        expect(init.body).toBeUndefined();
        expect(init.headers).toBeUndefined();
    });
    it('encodes the token and item id', async () => {
        fetchMock.mockResolvedValue(jsonOk({ token: 't', currency: 'USD', items: [], subtotalCents: 0 }));
        await api().cart.removeItem('a b', 'x/y');
        expect(calledUrl()).toBe('/api/cart/a%20b/items/x%2Fy');
    });
});
/* ============================ orders ============================ */
describe('orders.get', () => {
    it('GETs /orders/:id and returns the order (with totalCents)', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 'o1', number: 'XN-1', totalCents: 1999, subtotalCents: 1999, items: [] }));
        const order = await api().orders.get('o1');
        expect(calledUrl()).toBe('/api/orders/o1');
        expect(order?.totalCents).toBe(1999);
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().orders.get('gone')).toBeNull();
    });
});
describe('orders.byNumber', () => {
    it('GETs the by-number route with the email query', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 'o1', number: 'XN-7QK4ZP', email: 'a@b.co', items: [] }));
        const order = await api().orders.byNumber('XN-7QK4ZP', 'a@b.co');
        expect(calledUrl()).toBe('/api/orders/by-number/XN-7QK4ZP?email=a%40b.co');
        expect(order?.number).toBe('XN-7QK4ZP');
    });
    it('returns null on 404 (unknown number or email mismatch)', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().orders.byNumber('XN-NOPE', 'a@b.co')).toBeNull();
    });
});
/* =========================== checkout =========================== */
describe('checkout.start', () => {
    it('POSTs /checkout/:cartToken with the body and returns {orderId, mode, payUrl}', async () => {
        fetchMock.mockResolvedValue(jsonOk({ orderId: 'o1', mode: 'mock', payUrl: '/checkout/pay?order=o1' }));
        const input = { email: 'a@b.co', successPath: '/ok', cancelPath: '/no' };
        const res = await api().checkout.start('tok-1', input);
        expect(calledUrl()).toBe('/api/checkout/tok-1');
        const init = calledInit();
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual(input);
        expect(res).toEqual({ orderId: 'o1', mode: 'mock', payUrl: '/checkout/pay?order=o1' });
    });
    it('surfaces a server 400 (bad/empty cart) as AppClientError', async () => {
        fetchMock.mockResolvedValue(jsonErr(400, 'VALIDATION_ERROR', 'Cart is empty.'));
        await expect(api().checkout.start('tok', { email: 'a@b.co' })).rejects.toMatchObject({
            status: 400,
            code: 'VALIDATION_ERROR',
        });
    });
});
describe('checkout.mockComplete', () => {
    it('POSTs /checkout/mock/complete with {orderId} and returns the paid order', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 'o1', status: 'paid', totalCents: 1999, items: [] }));
        const order = await api().checkout.mockComplete('o1');
        expect(calledUrl()).toBe('/api/checkout/mock/complete');
        const init = calledInit();
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ orderId: 'o1' });
        expect(order.status).toBe('paid');
    });
    it('surfaces a 403 (stripe mode) as AppClientError', async () => {
        fetchMock.mockResolvedValue(jsonErr(403, 'FORBIDDEN', 'Mock completion is disabled when COMMERCE_MODE=stripe.'));
        await expect(api().checkout.mockComplete('o1')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });
});
describe('checkout.order', () => {
    it('GETs /checkout/order/:id and returns the order', async () => {
        fetchMock.mockResolvedValue(jsonOk({ id: 'o1', number: 'XN-1', totalCents: 1999, items: [] }));
        const order = await api().checkout.order('o1');
        expect(calledUrl()).toBe('/api/checkout/order/o1');
        expect(order?.id).toBe('o1');
    });
    it('returns null on 404', async () => {
        fetchMock.mockResolvedValue(jsonErr(404));
        expect(await api().checkout.order('gone')).toBeNull();
    });
});
describe('AppClientError', () => {
    it('carries status, code, and message', () => {
        const e = new errors_1.AppClientError(429, 'RATE_LIMITED', 'Slow down');
        expect(e.status).toBe(429);
        expect(e.code).toBe('RATE_LIMITED');
        expect(e.message).toBe('Slow down');
        expect(e.name).toBe('AppClientError');
        expect(e).toBeInstanceOf(Error);
    });
    it('falls back to a status-only message when the body has none', async () => {
        fetchMock.mockResolvedValue(jsonErr(502));
        await expect(api().cms.items('posts')).rejects.toMatchObject({
            status: 502,
            message: 'Request failed with status 502',
        });
    });
    it('tolerates a non-JSON error body', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => {
                throw new Error('not json');
            },
        });
        await expect(api().cms.items('posts')).rejects.toMatchObject({ status: 500 });
    });
});
describe('formatDate', () => {
    it('formats a valid ISO date', () => {
        expect((0, format_1.formatDate)('2026-07-09T00:00:00Z')).toMatch(/Jul\s+\d{1,2},\s+2026/);
    });
    it('returns "" for an invalid date', () => {
        expect((0, format_1.formatDate)('not-a-date')).toBe('');
    });
    it('returns "" for an empty string', () => {
        expect((0, format_1.formatDate)('')).toBe('');
    });
});
//# sourceMappingURL=app-client.spec.js.map