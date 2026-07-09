import type { XenitionClient } from '../xenition-client';
import { reviewsRouter } from './reviews-router';

const makeClient = () => {
  const reviews = {
    listApproved: jest.fn(),
    aggregate: jest.fn(),
    submit: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, reviews } } as unknown as XenitionClient;
  return { client, reviews, use };
};

const postJson = (
  app: ReturnType<typeof reviewsRouter>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('GET /:targetType/:targetId', () => {
  it('returns approved reviews (normalized) and the aggregate in one payload', async () => {
    const { client, reviews, use } = makeClient();
    reviews.listApproved.mockResolvedValue([
      {
        id: 'r1',
        target_type: 'product',
        target_id: 'p42',
        author_name: 'Ada',
        rating: 5,
        status: 'approved',
        created_at: 't0',
      },
    ]);
    reviews.aggregate.mockResolvedValue({ count: 1, average: 5 });
    const res = await reviewsRouter({ client }).request('/product/p42');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.reviews).toEqual([
      {
        id: 'r1',
        targetType: 'product',
        targetId: 'p42',
        authorName: 'Ada',
        rating: 5,
        status: 'approved',
        createdAt: 't0',
      },
    ]);
    expect(body.aggregate).toEqual({ count: 1, average: 5 });
    expect(reviews.listApproved).toHaveBeenCalledWith(
      { type: 'product', id: 'p42' },
      { limit: undefined, offset: undefined },
    );
    expect(reviews.aggregate).toHaveBeenCalledWith({ type: 'product', id: 'p42' });
    expect(use).toHaveBeenCalledWith('reviews');
  });

  it('forwards limit/offset and 400s bad values', async () => {
    const { client, reviews } = makeClient();
    reviews.listApproved.mockResolvedValue([]);
    reviews.aggregate.mockResolvedValue({ count: 0, average: null });
    const app = reviewsRouter({ client });
    await app.request('/product/p42?limit=3&offset=6');
    expect(reviews.listApproved).toHaveBeenCalledWith(
      { type: 'product', id: 'p42' },
      { limit: 3, offset: 6 },
    );
    expect((await app.request('/product/p42?limit=-1')).status).toBe(400);
  });
});

describe('POST /:targetType/:targetId', () => {
  it('submits a review (always lands pending) and returns 201', async () => {
    const { client, reviews } = makeClient();
    reviews.submit.mockResolvedValue({ id: 'r9', status: 'pending' });
    const res = await postJson(reviewsRouter({ client }), '/product/p42', {
      authorName: 'Ada',
      rating: 4.6,
      title: 'Great',
      body: 'Loved it',
    });
    expect(res.status).toBe(201);
    expect(await res.json() as any).toEqual({ id: 'r9', status: 'pending' });
    expect(reviews.submit).toHaveBeenCalledWith({
      target: { type: 'product', id: 'p42' },
      authorName: 'Ada',
      rating: 4.6,
      title: 'Great',
      body: 'Loved it',
    });
  });

  it("400s with the SDK's validation message on bad input", async () => {
    const { client, reviews } = makeClient();
    reviews.submit.mockRejectedValue(
      new Error('ReviewsClient.submit: "rating" must be a finite number (1-5)'),
    );
    const res = await postJson(reviewsRouter({ client }), '/product/p42', {
      authorName: 'Ada',
      rating: 'five',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"rating" must be a finite number');
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    expect((await postJson(reviewsRouter({ client }), '/product/p42', 'hi')).status).toBe(400);
  });

  it('rate limits POSTs but never the GET on the same path', async () => {
    const { client, reviews } = makeClient();
    reviews.submit.mockResolvedValue({ id: 'r1', status: 'pending' });
    reviews.listApproved.mockResolvedValue([]);
    reviews.aggregate.mockResolvedValue({ count: 0, average: null });
    const app = reviewsRouter({ client, rateLimit: 1 });
    const ip = { 'cf-connecting-ip': '203.0.113.7' };
    expect((await postJson(app, '/product/p42', { authorName: 'A', rating: 5 }, ip)).status).toBe(201);
    expect((await postJson(app, '/product/p42', { authorName: 'A', rating: 5 }, ip)).status).toBe(429);
    expect((await app.request('/product/p42', { headers: ip })).status).toBe(200);
  });
});
