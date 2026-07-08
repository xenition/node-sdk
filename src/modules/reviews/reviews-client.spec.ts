import { HttpClient } from '../../core/http-client';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { ReviewsClient, REVIEWS_TABLE } from './reviews-client';
import { SubmitReviewInput } from './types';

const makeReviews = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, reviews: new ReviewsClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const TARGET = { type: 'product', id: 'p_1' };

const input = (overrides: Partial<SubmitReviewInput> = {}): SubmitReviewInput => ({
  target: TARGET,
  authorName: 'Ada',
  rating: 4,
  ...overrides,
});

describe('submit', () => {
  it('inserts a pending review with defaults for title/body', async () => {
    const { post, reviews } = makeReviews();
    post.mockResolvedValue({ data: [] });
    const review = await reviews.submit(input({ title: 'Nice', body: 'Works great' }));

    expect(review).toEqual(
      expect.objectContaining({
        target_type: 'product',
        target_id: 'p_1',
        author_name: 'Ada',
        rating: 4,
        title: 'Nice',
        body: 'Works great',
        status: 'pending',
      }),
    );
    const payload = payloadOf(post, 0);
    expect(payload.type).toBe('INSERT');
    expect(payload.table).toBe(REVIEWS_TABLE);
    expect(payload.data).toEqual({ ...review });
  });

  it('always forces status pending — callers cannot self-approve', async () => {
    const { post, reviews } = makeReviews();
    post.mockResolvedValue({ data: [] });
    const sneaky = { ...input(), status: 'approved' } as SubmitReviewInput;
    const review = await reviews.submit(sneaky);
    expect(review.status).toBe('pending');
    expect((payloadOf(post, 0).data as Record<string, unknown>).status).toBe('pending');
  });

  it.each([
    [7, 5],
    [0, 1],
    [-3, 1],
    [4.6, 5],
    [2.4, 2],
    [2.5, 3],
    [1, 1],
    [5, 5],
  ])('clamps/rounds rating %p to %p', async (given, stored) => {
    const { post, reviews } = makeReviews();
    post.mockResolvedValue({ data: [] });
    const review = await reviews.submit(input({ rating: given }));
    expect(review.rating).toBe(stored);
  });

  it('rejects non-numeric ratings instead of guessing', async () => {
    const { reviews } = makeReviews();
    await expect(reviews.submit(input({ rating: NaN }))).rejects.toThrow(
      /"rating" must be a finite number/,
    );
    await expect(
      reviews.submit(input({ rating: '5' as unknown as number })),
    ).rejects.toThrow(/"rating" must be a finite number/);
  });

  it('validates target and author', async () => {
    const { reviews } = makeReviews();
    await expect(
      reviews.submit(input({ target: undefined as unknown as SubmitReviewInput['target'] })),
    ).rejects.toThrow(/"target" must be \{type, id\}/);
    await expect(
      reviews.submit(input({ target: { type: 'product', id: '' } })),
    ).rejects.toThrow(/"target\.id"/);
    await expect(reviews.submit(input({ authorName: ' ' }))).rejects.toThrow(/"authorName"/);
  });
});

describe('listApproved', () => {
  it('filters to the target + approved status, newest first', async () => {
    const { post, reviews } = makeReviews();
    post.mockResolvedValue({ data: [{ id: 'r1' }] });
    await expect(reviews.listApproved(TARGET, { limit: 5, offset: 10 })).resolves.toEqual([
      { id: 'r1' },
    ]);
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: REVIEWS_TABLE,
        where: [
          { column: 'target_type', operator: '=', value: 'product', type: 'AND' },
          { column: 'target_id', operator: '=', value: 'p_1', type: 'AND' },
          { column: 'status', operator: '=', value: 'approved', type: 'AND' },
        ],
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
        limit: 5,
        offset: 10,
      }),
    );
  });
});

describe('aggregate', () => {
  // The live dev runtime rejects SQL expressions in select columns — only
  // the dedicated /query/count endpoint aggregates. aggregate() therefore
  // makes (1) a count() call and, when count > 0, (2) a rating-column
  // select averaged client-side.
  it('counts via the count endpoint, then averages the rating column client-side', async () => {
    const { post, reviews } = makeReviews();
    post
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ data: [{ rating: 5 }, { rating: 4 }, { rating: '4' }] });
    const agg = await reviews.aggregate(TARGET);
    expect(agg.count).toBe(3);
    expect(agg.average).toBeCloseTo(4.3333, 3);
    // call 0: the scoped count
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: REVIEWS_TABLE,
        where: expect.arrayContaining([
          { column: 'status', operator: '=', value: 'approved', type: 'AND' },
        ]),
      }),
    );
    // call 1: the rating-only select, same scope
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: REVIEWS_TABLE,
        columns: ['rating'],
        where: expect.arrayContaining([
          { column: 'status', operator: '=', value: 'approved', type: 'AND' },
        ]),
      }),
    );
  });

  it('coerces Postgres string numerics and skips non-numeric ratings', async () => {
    const { post, reviews } = makeReviews();
    post
      .mockResolvedValueOnce({ count: '2' })
      .mockResolvedValueOnce({ data: [{ rating: '4' }, { rating: 5 }, { rating: 'junk' }] });
    await expect(reviews.aggregate(TARGET)).resolves.toEqual({ count: 2, average: 4.5 });
  });

  it('returns {count: 0, average: null} without a second call when there are no approved reviews', async () => {
    const { post, reviews } = makeReviews();
    post.mockResolvedValueOnce({ count: 0 });
    await expect(reviews.aggregate(TARGET)).resolves.toEqual({ count: 0, average: null });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('survives a count with an empty rating result set', async () => {
    const { post, reviews } = makeReviews();
    post.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ data: [] });
    await expect(reviews.aggregate(TARGET)).resolves.toEqual({ count: 2, average: null });
  });
});

describe('moderate', () => {
  it('updates the status by id', async () => {
    const { post, reviews } = makeReviews();
    post.mockResolvedValue({ data: [] });
    await reviews.moderate('r1', 'approved');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        type: 'UPDATE',
        table: REVIEWS_TABLE,
        data: { status: 'approved' },
        where: [{ column: 'id', operator: '=', value: 'r1', type: 'AND' }],
      }),
    );
  });

  it('rejects unknown statuses and empty ids', async () => {
    const { reviews } = makeReviews();
    await expect(reviews.moderate('r1', 'starred' as never)).rejects.toThrow(
      /"status" must be one of pending, approved, rejected/,
    );
    await expect(reviews.moderate('', 'approved')).rejects.toThrow(/"id"/);
  });
});
