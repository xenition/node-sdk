import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import {
  fail,
  generateId,
  isPlainObject,
  nowIso,
  optionalNumber,
  optionalString,
  requireNonEmptyString,
  toNumber,
} from '../util';
import {
  ListReviewsOptions,
  Review,
  ReviewAggregate,
  ReviewStatus,
  ReviewTarget,
  SubmitReviewInput,
} from './types';

export const REVIEWS_TABLE = 'reviews__reviews';

export const REVIEWS_MIGRATIONS: Migration[] = [
  {
    id: 'reviews/0001_create_reviews__reviews',
    sql: `CREATE TABLE IF NOT EXISTS ${REVIEWS_TABLE} (
  id uuid PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  author_name text NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'reviews/0002_index_reviews__reviews_target',
    sql: `CREATE INDEX IF NOT EXISTS reviews__reviews_target_idx ON ${REVIEWS_TABLE} (target_type, target_id, status)`,
  },
];

const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected'];

/**
 * reviews module client — moderated star ratings over `reviews__reviews`.
 *
 * `submit()` is anon-key friendly (a single INSERT, always status
 * `pending`); `moderate()` is the service-key back-office call that flips
 * pending → approved/rejected. Public surfaces (`listApproved`,
 * `aggregate`) only ever see approved rows.
 */
export class ReviewsClient {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * Insert a review, status `pending`. The rating is validated to be a
   * finite number, then rounded to the nearest integer and clamped into
   * 1–5 (a 4.6-star widget submits 5; a buggy 7 becomes 5, 0 becomes 1).
   */
  async submit(input: SubmitReviewInput): Promise<Review> {
    const context = 'ReviewsClient.submit';
    const target = this.validateTarget(context, input.target);
    const authorName = requireNonEmptyString(context, 'authorName', input.authorName);
    if (typeof input.rating !== 'number' || !Number.isFinite(input.rating)) {
      fail(context, '"rating" must be a finite number (1-5)');
    }
    const rating = Math.min(5, Math.max(1, Math.round(input.rating)));

    const review: Review = {
      id: generateId(),
      target_type: target.type,
      target_id: target.id,
      author_name: authorName,
      rating,
      title: optionalString(context, 'title', input.title, ''),
      body: optionalString(context, 'body', input.body, ''),
      status: 'pending',
      created_at: nowIso(),
    };
    await this.ctx.query.from(REVIEWS_TABLE).insert({ ...review }).execute();
    return review;
  }

  /** Approved reviews for a target, newest first. */
  async listApproved(target: ReviewTarget, options: ListReviewsOptions = {}): Promise<Review[]> {
    const context = 'ReviewsClient.listApproved';
    const t = this.validateTarget(context, target);
    let qb = this.ctx.query
      .from(REVIEWS_TABLE)
      .where('target_type', t.type)
      .where('target_id', t.id)
      .where('status', 'approved')
      .orderBy('created_at', 'DESC');
    if (options.limit !== undefined) qb = qb.limit(optionalNumber(context, 'limit', options.limit, 0));
    if (options.offset !== undefined) qb = qb.offset(optionalNumber(context, 'offset', options.offset, 0));
    return qb.rows<Review>();
  }

  /**
   * `{count, average}` over the target's *approved* reviews, computed by
   * the database (one aggregate SELECT — no row fan-out). Postgres returns
   * numerics as strings over JSON; both values are coerced here.
   */
  async aggregate(target: ReviewTarget): Promise<ReviewAggregate> {
    const context = 'ReviewsClient.aggregate';
    const t = this.validateTarget(context, target);
    const row = await this.ctx.query
      .from(REVIEWS_TABLE)
      .select('COUNT(*) as count', 'AVG(rating) as average')
      .where('target_type', t.type)
      .where('target_id', t.id)
      .where('status', 'approved')
      .first<{ count: unknown; average: unknown }>();
    const count = toNumber(row?.count) ?? 0;
    const average = count > 0 ? toNumber(row?.average) : null;
    return { count, average };
  }

  /** Flip a review's moderation status (service key). */
  async moderate(id: string, status: ReviewStatus): Promise<void> {
    const context = 'ReviewsClient.moderate';
    requireNonEmptyString(context, 'id', id);
    if (!REVIEW_STATUSES.includes(status)) {
      fail(context, `"status" must be one of ${REVIEW_STATUSES.join(', ')} — got "${String(status)}"`);
    }
    await this.ctx.query.from(REVIEWS_TABLE).update({ status }).where('id', id).execute();
  }

  // ───────── internals ─────────

  private validateTarget(context: string, target: unknown): ReviewTarget {
    if (!isPlainObject(target)) fail(context, '"target" must be {type, id}');
    return {
      type: requireNonEmptyString(context, 'target.type', target.type),
      id: requireNonEmptyString(context, 'target.id', target.id),
    };
  }
}

/** The reviews module definition — wire it up via `client.modules.enable('reviews')`. */
export const reviewsModule = defineModule({
  name: 'reviews',
  migrations: REVIEWS_MIGRATIONS,
  factory: (ctx: ModuleContext) => new ReviewsClient(ctx),
});
