import { createAppClient } from './app-client';
import { AppClientError } from './errors';
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
