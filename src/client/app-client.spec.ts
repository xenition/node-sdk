import { createAppClient } from './app-client';
import { AppClientError, isPaymentRequired } from './errors';
import { formatDate } from './format';

/**
 * Unit tests for `@xenition/sdk/client`. `global.fetch` is mocked so we
 * assert the exact URL + query construction, method/body of writes, the
 * 404→null vs throw contract, and camelCase passthrough — with NO network.
 */

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

let fetchMock: FetchMock;

/** A minimal `Response`-like for a JSON 2xx. */
function jsonOk(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A `Response`-like for an error status carrying the router error body. */
function jsonErr(status: number, code?: string, message?: string): Response {
  return {
    ok: false,
    status,
    json: async () => (code || message ? { error: { code, message } } : {}),
  } as unknown as Response;
}

/** The single URL the mock was called with. */
function calledUrl(): string {
  return fetchMock.mock.calls[0]![0] as string;
}

/** The RequestInit the mock was called with (for POST assertions). */
function calledInit(): RequestInit {
  return fetchMock.mock.calls[0]![1] as RequestInit;
}

beforeEach(() => {
  fetchMock = jest.fn();
  (global as { fetch: unknown }).fetch = fetchMock;
});

const api = () => createAppClient('/api');

describe('baseUrl handling', () => {
  it('joins path onto the base', async () => {
    fetchMock.mockResolvedValue(jsonOk({}));
    await createAppClient('/api').cms.page('x');
    expect(calledUrl()).toBe('/api/cms/pages/x');
  });

  it('strips a trailing slash from the base', async () => {
    fetchMock.mockResolvedValue(jsonOk({}));
    await createAppClient('https://app.example.com/api/').cms.page('x');
    expect(calledUrl()).toBe('https://app.example.com/api/cms/pages/x');
  });

  it('works with an empty base (relative)', async () => {
    fetchMock.mockResolvedValue(jsonOk({ items: [] }));
    await createAppClient('').cms.items('posts');
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
    await expect(api().cms.page('x')).rejects.toBeInstanceOf(AppClientError);
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
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(input);
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
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Ada', email: 'a@b.co', partySize: 2 });
    expect(res).toEqual({ id: 'r1', status: 'confirmed' });
  });
});

describe('events.getRsvp', () => {
  it('GETs the rsvp route and returns it (the id is the access token)', async () => {
    fetchMock.mockResolvedValue(jsonOk({ id: 'r1', eventId: 'e1', name: 'Ada', partySize: 2 }));
    const rsvp = await api().events.getRsvp('r1');
    expect(calledUrl()).toBe('/api/events/rsvps/r1');
    expect(rsvp?.eventId).toBe('e1');
    expect(rsvp?.partySize).toBe(2);
  });

  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(jsonErr(404));
    expect(await api().events.getRsvp('gone')).toBeNull();
  });
});

describe('forms.schema', () => {
  it('GETs the form and returns the schema', async () => {
    const form = { id: '1', key: 'contact', name: 'Contact', fields: [{ name: 'email', type: 'email' }], createdAt: 'a', updatedAt: 'b' };
    fetchMock.mockResolvedValue(jsonOk(form));
    const schema = await api().forms.schema('contact');
    expect(calledUrl()).toBe('/api/forms/contact');
    expect(schema.fields[0]!.name).toBe('email');
  });

  it('THROWS on 404 (schema is not nullable)', async () => {
    fetchMock.mockResolvedValue(jsonErr(404, 'NOT_FOUND', 'Route not found.'));
    await expect(api().forms.schema('nope')).rejects.toBeInstanceOf(AppClientError);
  });
});

describe('forms.submit', () => {
  it('POSTs the data to /forms/:key/submissions and returns {id}', async () => {
    fetchMock.mockResolvedValue(jsonOk({ id: 's1' }, 201));
    const data = { email: 'a@b.co', message: 'hi' };
    const res = await api().forms.submit('contact', data);
    expect(calledUrl()).toBe('/api/forms/contact/submissions');
    expect(JSON.parse(calledInit().body as string)).toEqual(data);
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
    expect(res.reviews[0]!.authorName).toBe('Ada');
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
    expect(JSON.parse(calledInit().body as string)).toEqual(input);
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
    expect(rows[0]!.slotMinutes).toBe(30);
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
    expect(slots[0]!.spotsLeft).toBe(2);
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
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(res).toEqual({ id: 'bk1', startsAt: 'a', status: 'confirmed' });
  });

  it('surfaces a 409 SLOT_UNAVAILABLE as AppClientError', async () => {
    fetchMock.mockResolvedValue(jsonErr(409, 'SLOT_UNAVAILABLE', 'That slot was just taken.'));
    await expect(
      api().booking.book('chair-1', { startsAt: 'a', customerName: 'Ada', customerEmail: 'a@b.co' }),
    ).rejects.toMatchObject({ status: 409, code: 'SLOT_UNAVAILABLE', message: 'That slot was just taken.' });
  });
});

/* ============================= media ============================= */

describe('booking.getBooking', () => {
  it('GETs the booking route and returns it (the id is the access token)', async () => {
    fetchMock.mockResolvedValue(jsonOk({ id: 'bk1', resourceId: 'r1', customerName: 'Ada', partySize: 1 }));
    const bkg = await api().booking.getBooking('bk1');
    expect(calledUrl()).toBe('/api/booking/bookings/bk1');
    expect(bkg?.resourceId).toBe('r1');
    expect(bkg?.customerName).toBe('Ada');
  });

  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(jsonErr(404));
    expect(await api().booking.getBooking('gone')).toBeNull();
  });
});

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
    expect(album?.items[0]!.albumId).toBe('1');
  });

  it('returns null on 404 (unknown/unpublished)', async () => {
    fetchMock.mockResolvedValue(jsonErr(404));
    expect(await api().media.album('gone')).toBeNull();
  });
});

describe('media.privateAlbum', () => {
  it('GETs the private route with the code query param and returns it merged with items', async () => {
    fetchMock.mockResolvedValue(
      jsonOk({ id: '2', slug: 'smith-wedding', published: false, items: [{ id: 'i1', albumId: '2' }] }),
    );
    const album = await api().media.privateAlbum('smith-wedding', 'sunset 24');
    expect(calledUrl()).toBe('/api/media/albums/smith-wedding/private?code=sunset%2024');
    expect(album?.slug).toBe('smith-wedding');
    expect(album?.items[0]!.albumId).toBe('2');
  });

  it('returns null on 404 (unknown slug or wrong code)', async () => {
    fetchMock.mockResolvedValue(jsonErr(404));
    expect(await api().media.privateAlbum('smith-wedding', 'wrong')).toBeNull();
  });
});

/* ============================ catalog ============================ */

describe('catalog.products', () => {
  it('unwraps { products } and builds collection/status/limit/offset', async () => {
    fetchMock.mockResolvedValue(jsonOk({ products: [{ id: '1', collectionId: null }] }));
    const rows = await api().catalog.products({ collection: 'shoes', status: 'all', limit: 4, offset: 8 });
    expect(calledUrl()).toBe('/api/catalog/products?collection=shoes&status=all&limit=4&offset=8');
    expect(rows[0]!.collectionId).toBeNull();
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
    expect(p?.variants[0]!.priceCents).toBe(1999);
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
    expect(cols[0]!.slug).toBe('shoes');
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
    await expect(api().catalog.collectionProducts('nope')).rejects.toBeInstanceOf(AppClientError);
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
    await expect(api().inventory.stock('v1')).rejects.toBeInstanceOf(AppClientError);
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
    expect(JSON.parse(init.body as string)).toEqual({});
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
    expect(JSON.parse(init.body as string)).toEqual({ variantId: 'v1', quantity: 1 });
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
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ quantity: 3 });
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
    expect(JSON.parse(init.body as string)).toEqual(input);
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
    expect(JSON.parse(init.body as string)).toEqual({ orderId: 'o1' });
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

/* ============================ billing =========================== */

describe('billing.products', () => {
  it('GETs the public product route and unwraps the envelope', async () => {
    const product = { id: 'p1', productId: 'com.acme.premium.monthly', platform: 'apple', entitlement: 'premium', kind: 'subscription', period: 'monthly', active: true, createdAt: 'a' };
    fetchMock.mockResolvedValue(jsonOk({ products: [product] }));
    const products = await api().billing.products();
    expect(calledUrl()).toBe('/api/billing/products');
    expect(products).toEqual([product]);
  });

  it('passes the platform filter through', async () => {
    fetchMock.mockResolvedValue(jsonOk({ products: [] }));
    await api().billing.products({ platform: 'google' });
    expect(calledUrl()).toBe('/api/billing/products?platform=google');
  });

  it('sends no Authorization header on a guest client (a paywall precedes sign-in)', async () => {
    fetchMock.mockResolvedValue(jsonOk({ products: [] }));
    await api().billing.products();
    expect(fetchMock.mock.calls[0]![1]).toBeUndefined();
  });

  it('returns [] when the envelope is empty', async () => {
    fetchMock.mockResolvedValue(jsonOk({}));
    expect(await api().billing.products()).toEqual([]);
  });
});

describe('billing.entitlements', () => {
  it('returns the derived checks the router builds, not raw rows', async () => {
    // `listEntitlements` BUILDS an EntitlementCheck per record rather than
    // handing the row through, so what arrives is already camelCase and
    // already answers "may they, right now". A client that camelized here
    // would be describing a route that does not exist.
    fetchMock.mockResolvedValue(jsonOk({ entitlements: [{ allowed: true, entitlement: 'premium', source: 'purchase', status: 'active', expiresAt: '2026-09-01T00:00:00Z', daysRemaining: 7, isTrial: false, reason: null }] }));
    const [entitlement] = await api().billing.entitlements();
    expect(calledUrl()).toBe('/api/billing/entitlements');
    expect(entitlement).toEqual({ allowed: true, entitlement: 'premium', source: 'purchase', status: 'active', expiresAt: '2026-09-01T00:00:00Z', daysRemaining: 7, isTrial: false, reason: null });
  });

  it('hands a perpetual entitlement through with its nulls intact', async () => {
    // `expiresAt: null` is "never expires", not "unknown" — a client that
    // filled it in would turn a lifetime purchase into an expired one.
    const perpetual = { allowed: true, entitlement: 'premium', source: 'grant', status: 'active', expiresAt: null, daysRemaining: null, isTrial: false, reason: null };
    fetchMock.mockResolvedValue(jsonOk({ entitlements: [perpetual] }));
    expect(await api().billing.entitlements()).toEqual([perpetual]);
  });

  it('returns [] when the envelope is empty', async () => {
    fetchMock.mockResolvedValue(jsonOk({}));
    expect(await api().billing.entitlements()).toEqual([]);
  });
});

describe('billing.entitlement', () => {
  it('GETs the check route and passes the built shape through untouched', async () => {
    const check = { allowed: true, entitlement: 'premium', source: 'trial', status: 'active', expiresAt: '2026-09-01T00:00:00Z', daysRemaining: 7, isTrial: true, reason: null };
    fetchMock.mockResolvedValue(jsonOk(check));
    expect(await api().billing.entitlement('premium')).toEqual(check);
    expect(calledUrl()).toBe('/api/billing/entitlements/premium');
  });

  it('treats never-had-it as a normal answer, not a 404', async () => {
    fetchMock.mockResolvedValue(jsonOk({ allowed: false, entitlement: 'premium', source: null, status: 'none', expiresAt: null, daysRemaining: null, isTrial: false, reason: 'none' }));
    const check = await api().billing.entitlement('premium');
    expect(check.allowed).toBe(false);
    expect(check.status).toBe('none');
  });

  it('encodes the key', async () => {
    fetchMock.mockResolvedValue(jsonOk({}));
    await api().billing.entitlement('pro/plus');
    expect(calledUrl()).toBe('/api/billing/entitlements/pro%2Fplus');
  });
});

describe('billing.verify', () => {
  it('POSTs the apple shape', async () => {
    fetchMock.mockResolvedValue(jsonOk({ ok: true, entitlement: null, product: null }, 201));
    await api().billing.verify({ platform: 'apple', transactionId: 'tx-1' });
    expect(calledUrl()).toBe('/api/billing/verify');
    expect(calledInit().method).toBe('POST');
    expect(JSON.parse(calledInit().body as string)).toEqual({ platform: 'apple', transactionId: 'tx-1' });
  });

  it('POSTs the google shape and surfaces `acknowledged`', async () => {
    fetchMock.mockResolvedValue(jsonOk({ ok: true, entitlement: { allowed: true }, product: { id: 'p1' }, acknowledged: false }, 201));
    const res = await api().billing.verify({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok', kind: 'subscription' });
    expect(JSON.parse(calledInit().body as string)).toEqual({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok', kind: 'subscription' });
    // false means Play was never told, and Play refunds unacknowledged
    // purchases after three days — so it must not be swallowed.
    expect(res.acknowledged).toBe(false);
  });

  it('surfaces a rejected receipt as the router 400', async () => {
    fetchMock.mockResolvedValue(jsonErr(400, 'VALIDATION_ERROR', '"transactionId" is required for apple.'));
    await expect(api().billing.verify({ platform: 'apple', transactionId: '' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});

describe('billing.restore', () => {
  it('POSTs the apple chain id and returns the resulting entitlements', async () => {
    // restore answers from `listEntitlements` too, so it hands back the
    // caller's whole entitlement picture, not only what it just recovered.
    fetchMock.mockResolvedValue(jsonOk({ entitlements: [{ allowed: true, entitlement: 'premium', source: 'purchase', status: 'active', expiresAt: '2026-09-01T00:00:00Z', daysRemaining: 7, isTrial: false, reason: null }] }));
    const entitlements = await api().billing.restore({ platform: 'apple', originalTransactionId: 'otx-1' });
    expect(calledUrl()).toBe('/api/billing/restore');
    expect(JSON.parse(calledInit().body as string)).toEqual({ platform: 'apple', originalTransactionId: 'otx-1' });
    expect(entitlements).toEqual([{ allowed: true, entitlement: 'premium', source: 'purchase', status: 'active', expiresAt: '2026-09-01T00:00:00Z', daysRemaining: 7, isTrial: false, reason: null }]);
  });

  it('POSTs the google token', async () => {
    fetchMock.mockResolvedValue(jsonOk({ entitlements: [] }));
    await api().billing.restore({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok' });
    expect(JSON.parse(calledInit().body as string)).toEqual({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok' });
  });
});

describe('billing.startTrial', () => {
  it('POSTs with NO body — the length is the server\'s, never a client argument', async () => {
    fetchMock.mockResolvedValue(jsonOk({ allowed: true, entitlement: 'premium', status: 'active', isTrial: true }, 201));
    const check = await api().billing.startTrial();
    expect(calledUrl()).toBe('/api/billing/trial');
    const init = calledInit();
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(check.isTrial).toBe(true);
  });

  it('surfaces the 501 of an app that offers no trial', async () => {
    fetchMock.mockResolvedValue(jsonErr(501, 'NOT_CONFIGURED', 'Trials are not enabled — set BILLING_TRIAL_DAYS or the trialDays option.'));
    await expect(api().billing.startTrial()).rejects.toMatchObject({ status: 501, code: 'NOT_CONFIGURED' });
  });
});

/* ========================== access token ======================== */

describe('accessToken', () => {
  const authed = (token: unknown) =>
    createAppClient('/api', { accessToken: token as string });

  it('attaches the bearer header to a GET', async () => {
    fetchMock.mockResolvedValue(jsonOk({ entitlements: [] }));
    await authed('tok-1').billing.entitlements();
    expect((calledInit().headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('attaches it alongside Content-Type on a write', async () => {
    fetchMock.mockResolvedValue(jsonOk({ ok: true, entitlement: null, product: null }, 201));
    await authed('tok-1').billing.verify({ platform: 'apple', transactionId: 'tx' });
    const headers = calledInit().headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('attaches it to a body-less write too', async () => {
    fetchMock.mockResolvedValue(jsonOk({ allowed: true }));
    await authed('tok-1').billing.startTrial();
    const init = calledInit();
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('reads the token per request, so a refresh is picked up', async () => {
    let token = 'first';
    const client = createAppClient('/api', { accessToken: () => token });
    fetchMock.mockResolvedValue(jsonOk({ count: 0 }));
    await client.notifications.unreadCount();
    token = 'second';
    await client.notifications.unreadCount();
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer first');
    expect((fetchMock.mock.calls[1]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer second');
  });

  it('awaits an async resolver (device storage)', async () => {
    fetchMock.mockResolvedValue(jsonOk({ count: 3 }));
    const client = createAppClient('/api', { accessToken: async () => 'stored' });
    expect(await client.notifications.unreadCount()).toBe(3);
    expect((calledInit().headers as Record<string, string>).Authorization).toBe('Bearer stored');
  });

  it('sends no header at all when the resolver has no token (signed out)', async () => {
    fetchMock.mockResolvedValue(jsonOk({ products: [] }));
    await createAppClient('/api', { accessToken: () => null }).billing.products();
    expect(fetchMock.mock.calls[0]![1]).toBeUndefined();
  });
});

/* ============================= auth ============================= */

describe('auth', () => {
  it('POSTs /auth/login and returns the session', async () => {
    const result = { user: { id: 'u1', email: 'a@b.co', role: 'user', createdAt: 'a', updatedAt: 'b' }, session: { id: 's1', userId: 'u1', expiresAt: 'z', createdAt: 'a' }, token: 't', refreshToken: 'r', expiresAt: 123 };
    fetchMock.mockResolvedValue(jsonOk(result));
    const res = await api().auth.login({ email: 'a@b.co', password: 'pw' });
    expect(calledUrl()).toBe('/api/auth/login');
    expect(JSON.parse(calledInit().body as string)).toEqual({ email: 'a@b.co', password: 'pw' });
    expect(res.refreshToken).toBe('r');
  });

  it('POSTs /auth/refresh with the refresh token in the body', async () => {
    fetchMock.mockResolvedValue(jsonOk({ token: 't2', refreshToken: 'r2' }));
    await api().auth.refresh('r1');
    expect(calledUrl()).toBe('/api/auth/refresh');
    expect(JSON.parse(calledInit().body as string)).toEqual({ refreshToken: 'r1' });
  });

  it('POSTs the id token to the provider route', async () => {
    fetchMock.mockResolvedValue(jsonOk({ token: 't' }));
    await api().auth.signInWithIdToken({ provider: 'apple', idToken: 'id-1', nonce: 'n' });
    expect(calledUrl()).toBe('/api/auth/oauth/apple/id-token');
    expect(JSON.parse(calledInit().body as string)).toEqual({ idToken: 'id-1', nonce: 'n' });
  });

  it('throws on a guest me() rather than collapsing 401 to null', async () => {
    fetchMock.mockResolvedValue(jsonErr(401, 'UNAUTHORIZED', 'Authentication required.'));
    await expect(api().auth.me()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('PATCHes the profile', async () => {
    fetchMock.mockResolvedValue(jsonOk({ id: 'u1', email: 'a@b.co', role: 'user', createdAt: 'a', updatedAt: 'b' }));
    await api().auth.updateProfile({ name: 'Ada' });
    expect(calledUrl()).toBe('/api/auth/profile');
    expect(calledInit().method).toBe('PATCH');
  });

  it('unwraps the sessions envelope', async () => {
    fetchMock.mockResolvedValue(jsonOk({ sessions: [{ id: 's1', userId: 'u1', expiresAt: 'z', createdAt: 'a' }] }));
    expect(await api().auth.sessions()).toHaveLength(1);
    expect(calledUrl()).toBe('/api/auth/sessions');
  });

  it('DELETEs one session by id', async () => {
    fetchMock.mockResolvedValue(jsonOk({ revoked: true }));
    await api().auth.revokeSession('s 1');
    expect(calledUrl()).toBe('/api/auth/sessions/s%201');
    expect(calledInit().method).toBe('DELETE');
  });

  it('returns how many revokeAllSessions signed out', async () => {
    fetchMock.mockResolvedValue(jsonOk({ revoked: 4 }));
    expect(await api().auth.revokeAllSessions()).toBe(4);
  });

  it('DELETEs the account and surfaces the grace period', async () => {
    fetchMock.mockResolvedValue(jsonOk({ deleted: true, purgeAt: '2026-09-03T00:00:00Z' }));
    const res = await api().auth.deleteAccount({ password: 'pw' });
    expect(calledUrl()).toBe('/api/auth/account');
    expect(calledInit().method).toBe('DELETE');
    expect(JSON.parse(calledInit().body as string)).toEqual({ password: 'pw' });
    expect(res.purgeAt).toBe('2026-09-03T00:00:00Z');
  });

  it('GETs the data export', async () => {
    fetchMock.mockResolvedValue(jsonOk({ user: { id: 'u1' }, generatedAt: 'now' }));
    expect((await api().auth.exportData()).generatedAt).toBe('now');
    expect(calledUrl()).toBe('/api/auth/account/export');
  });

  it('unwraps the social provider list', async () => {
    fetchMock.mockResolvedValue(jsonOk({ providers: [{ provider: 'google', isAvailable: true }] }));
    const providers = await api().auth.socialProviders();
    expect(calledUrl()).toBe('/api/auth/oauth/providers');
    expect(providers[0]!.isAvailable).toBe(true);
  });

  it('builds the oauth url route with the redirect query', async () => {
    fetchMock.mockResolvedValue(jsonOk({ url: 'https://x', state: 's' }));
    await api().auth.oauthUrl('google', 'https://app.example.com/cb');
    expect(calledUrl()).toBe('/api/auth/oauth/google/url?redirectUrl=https%3A%2F%2Fapp.example.com%2Fcb');
  });
});

/* ============================= jobs ============================= */

describe('jobs.get', () => {
  it('GETs /jobs/:id and returns the polling view', async () => {
    const job = { id: 'j1', type: 'speech.analyze', status: 'succeeded', attempts: 1, done: true, result: { score: 9 }, failed: false, createdAt: 'a', updatedAt: 'b' };
    fetchMock.mockResolvedValue(jsonOk(job));
    const res = await api().jobs.get('j1');
    expect(calledUrl()).toBe('/api/jobs/j1');
    expect(res).toEqual(job);
  });

  it('keeps `failed` (a rest between retries) distinct from `done`', async () => {
    fetchMock.mockResolvedValue(jsonOk({ id: 'j1', status: 'failed', attempts: 2, done: false, failed: false, result: null }));
    const res = await api().jobs.get('j1');
    expect(res!.status).toBe('failed');
    // Still coming back — `done`/`failed` are what a poller stops on.
    expect(res!.done).toBe(false);
    expect(res!.failed).toBe(false);
  });

  it('returns null for an unknown id AND for another user\'s job (same 404)', async () => {
    fetchMock.mockResolvedValue(jsonErr(404, 'NOT_FOUND', 'Job not found.'));
    expect(await api().jobs.get('someone-elses')).toBeNull();
  });

  it('encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonOk({}));
    await api().jobs.get('a/b');
    expect(calledUrl()).toBe('/api/jobs/a%2Fb');
  });
});

/* ========================= notifications ======================== */

describe('notifications.inbox', () => {
  it('GETs the feed and returns the page whole', async () => {
    const page = { notifications: [{ id: 'n1', userId: 'u1', category: 'reminder', title: 'T', body: 'B', data: {}, readAt: null, createdAt: '2026-08-01T00:00:00Z', expiresAt: null }], nextCursor: '2026-08-01T00:00:00Z' };
    fetchMock.mockResolvedValue(jsonOk(page));
    const res = await api().notifications.inbox();
    expect(calledUrl()).toBe('/api/notifications');
    expect(res).toEqual(page);
  });

  it('pages on nextCursor — a keyset, never an offset', async () => {
    fetchMock.mockResolvedValue(jsonOk({ notifications: [], nextCursor: null }));
    await api().notifications.inbox({ before: '2026-08-01T00:00:00Z', limit: 50 });
    expect(calledUrl()).toBe('/api/notifications?limit=50&before=2026-08-01T00%3A00%3A00Z');
  });

  it('sends unread as the router\'s 1/0 flag', async () => {
    fetchMock.mockResolvedValue(jsonOk({ notifications: [], nextCursor: null }));
    await api().notifications.inbox({ unread: true, category: 'billing' });
    expect(calledUrl()).toBe('/api/notifications?unread=1&category=billing');
  });

  it('carries a null nextCursor through as "the feed is done"', async () => {
    fetchMock.mockResolvedValue(jsonOk({ notifications: [], nextCursor: null }));
    expect((await api().notifications.inbox()).nextCursor).toBeNull();
  });
});

describe('notifications.unreadCount', () => {
  it('unwraps the badge number', async () => {
    fetchMock.mockResolvedValue(jsonOk({ count: 7 }));
    expect(await api().notifications.unreadCount()).toBe(7);
    expect(calledUrl()).toBe('/api/notifications/unread-count');
  });
});

describe('notifications.markRead', () => {
  it('POSTs the read route with no body', async () => {
    fetchMock.mockResolvedValue(jsonOk({ read: true }));
    await api().notifications.markRead('n 1');
    expect(calledUrl()).toBe('/api/notifications/n%201/read');
    const init = calledInit();
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });
});

describe('notifications.markAllRead', () => {
  it('returns the resulting unread count instead of a second round trip', async () => {
    fetchMock.mockResolvedValue(jsonOk({ read: true, unreadCount: 0 }));
    expect(await api().notifications.markAllRead()).toBe(0);
    expect(calledUrl()).toBe('/api/notifications/read-all');
    expect(calledInit().method).toBe('POST');
  });
});

describe('notifications.preferences', () => {
  it('unwraps the preferences envelope', async () => {
    fetchMock.mockResolvedValue(jsonOk({ preferences: [{ id: 'p1', userId: 'u1', category: 'general', inApp: true, push: true, email: false, quietStartMinute: 1320, quietEndMinute: 420, utcOffsetMinutes: -300, updatedAt: 'a' }] }));
    const [preference] = await api().notifications.preferences();
    expect(calledUrl()).toBe('/api/notifications/preferences');
    expect(preference!.quietStartMinute).toBe(1320);
  });

  it('returns [] when the envelope is empty', async () => {
    fetchMock.mockResolvedValue(jsonOk({}));
    expect(await api().notifications.preferences()).toEqual([]);
  });
});

describe('notifications.savePreferences', () => {
  it('PUTs the camelCase patch and returns EVERY row it touched', async () => {
    fetchMock.mockResolvedValue(jsonOk({ preferences: [{ id: 'p1', category: 'general' }, { id: 'p2', category: 'billing' }] }));
    // No category: one quiet-hours control means "quiet everywhere", so the
    // patch lands on every configured category — hence the plural.
    const written = await api().notifications.savePreferences({ quietStartMinute: 1320, quietEndMinute: 420 });
    expect(calledUrl()).toBe('/api/notifications/preferences');
    expect(calledInit().method).toBe('PUT');
    expect(JSON.parse(calledInit().body as string)).toEqual({ quietStartMinute: 1320, quietEndMinute: 420 });
    expect(written).toHaveLength(2);
  });

  it('sends null through as "clear the window" rather than dropping it', async () => {
    fetchMock.mockResolvedValue(jsonOk({ preferences: [] }));
    await api().notifications.savePreferences({ category: 'reminder', quietStartMinute: null, quietEndMinute: null });
    expect(JSON.parse(calledInit().body as string)).toEqual({ category: 'reminder', quietStartMinute: null, quietEndMinute: null });
  });
});

describe('AppClientError', () => {
  it('carries status, code, and message', () => {
    const e = new AppClientError(429, 'RATE_LIMITED', 'Slow down');
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
    } as unknown as Response);
    await expect(api().cms.items('posts')).rejects.toMatchObject({ status: 500 });
  });
});

/* ======================== payment required ====================== */

describe('402', () => {
  /** A `Response`-like for an arbitrary error body (the 402 blocks). */
  const errBody = (status: number, body: unknown): Response =>
    ({ ok: false, status, json: async () => body } as unknown as Response);

  /**
   * The rejection, typed. `.catch()` widens to a union with whatever the
   * call resolves to, which is not what any of these assertions mean.
   */
  const caught = (p: Promise<unknown>): Promise<AppClientError> =>
    p.then(
      () => {
        throw new Error('expected a rejection');
      },
      (err: unknown) => err as AppClientError,
    );

  /** The gate's body: `requireEntitlement('premium')` refused. */
  const gateBody = {
    error: { code: 'PAYMENT_REQUIRED', message: 'This feature requires "premium".' },
    entitlement: 'premium',
    check: { allowed: false, entitlement: 'premium', source: null, status: 'none', expiresAt: null, daysRemaining: null, isTrial: false, reason: 'none' },
  };

  /** The meter's body: the free allowance is spent. Same status, same code. */
  const meterBody = {
    error: { code: 'PAYMENT_REQUIRED', message: 'You have used all 5 of your "analysis" allowance.' },
    entitlement: 'premium',
    quota: { key: 'analysis', limit: 5, used: 5, resetAt: '2026-09-01T00:00:00Z' },
  };

  it('flags a 402 as the paywall, not a failure', async () => {
    fetchMock.mockResolvedValue(errBody(402, gateBody));
    await expect(api().jobs.get('j1')).rejects.toMatchObject({ status: 402, isPaymentRequired: true });
  });

  it('lifts the entitlement KEY and the gate full check', async () => {
    fetchMock.mockResolvedValue(errBody(402, gateBody));
    const err = await caught(api().billing.entitlements());
    expect(err).toBeInstanceOf(AppClientError);
    expect(err.code).toBe('PAYMENT_REQUIRED');
    expect(err.entitlement).toBe('premium');
    expect(err.check).toEqual(gateBody.check);
    // No meter refused, so no quota — that absence IS the distinction.
    expect(err.quota).toBeUndefined();
  });

  it('lifts the quota, so a paywall can say when the window resets', async () => {
    fetchMock.mockResolvedValue(errBody(402, meterBody));
    const err = await caught(api().billing.entitlements());
    expect(err.quota).toEqual(meterBody.quota);
    expect(err.quota!.resetAt).toBe('2026-09-01T00:00:00Z');
    expect(err.entitlement).toBe('premium');
    expect(err.check).toBeUndefined();
  });

  it('tells the two refusals apart by the presence of quota, not by the code', async () => {
    fetchMock.mockResolvedValue(errBody(402, gateBody));
    const gate = await caught(api().billing.entitlements());
    fetchMock.mockResolvedValue(errBody(402, meterBody));
    const meter = await caught(api().billing.entitlements());
    expect(gate.code).toBe(meter.code);
    expect(gate.quota).toBeUndefined();
    expect(meter.quota).toBeDefined();
  });

  it('needs no fields to be recognised — the STATUS decides', async () => {
    // An app's own HTTPException(402) never went through the SDK helper.
    fetchMock.mockResolvedValue(jsonErr(402, 'PAYMENT_REQUIRED', 'Payment required.'));
    const err = await caught(api().billing.entitlements());
    expect(err.isPaymentRequired).toBe(true);
    expect(err.entitlement).toBeUndefined();
  });

  it('ignores a half-built body rather than reporting allowed: undefined', async () => {
    fetchMock.mockResolvedValue(errBody(402, { error: { code: 'X' }, entitlement: '', quota: {}, check: {} }));
    const err = await caught(api().billing.entitlements());
    expect(err.entitlement).toBeUndefined();
    expect(err.quota).toBeUndefined();
    expect(err.check).toBeUndefined();
  });

  it('does not flag any other status', async () => {
    fetchMock.mockResolvedValue(jsonErr(403, 'FORBIDDEN'));
    const err = await caught(api().billing.entitlements());
    expect(err.isPaymentRequired).toBe(false);
  });

  it('narrows an unknown catch with isPaymentRequired()', async () => {
    fetchMock.mockResolvedValue(errBody(402, meterBody));
    try {
      await api().jobs.get('j1');
      throw new Error('should have thrown');
    } catch (err: unknown) {
      expect(isPaymentRequired(err)).toBe(true);
      if (isPaymentRequired(err)) expect(err.quota!.used).toBe(5);
    }
    expect(isPaymentRequired(new Error('nope'))).toBe(false);
  });
});

describe('formatDate', () => {
  it('formats a valid ISO date', () => {
    expect(formatDate('2026-07-09T00:00:00Z')).toMatch(/Jul\s+\d{1,2},\s+2026/);
  });

  it('returns "" for an invalid date', () => {
    expect(formatDate('not-a-date')).toBe('');
  });

  it('returns "" for an empty string', () => {
    expect(formatDate('')).toBe('');
  });
});
