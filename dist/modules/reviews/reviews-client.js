"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewsModule = exports.ReviewsClient = exports.REVIEWS_MIGRATIONS = exports.REVIEWS_TABLE = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.REVIEWS_TABLE = 'reviews__reviews';
exports.REVIEWS_MIGRATIONS = [
    {
        id: 'reviews/0001_create_reviews__reviews',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.REVIEWS_TABLE} (
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
        sql: `CREATE INDEX IF NOT EXISTS reviews__reviews_target_idx ON ${exports.REVIEWS_TABLE} (target_type, target_id, status)`,
    },
];
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
/**
 * reviews module client — moderated star ratings over `reviews__reviews`.
 *
 * `submit()` is anon-key friendly (a single INSERT, always status
 * `pending`); `moderate()` is the service-key back-office call that flips
 * pending → approved/rejected. Public surfaces (`listApproved`,
 * `aggregate`) only ever see approved rows.
 */
class ReviewsClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Insert a review, status `pending`. The rating is validated to be a
     * finite number, then rounded to the nearest integer and clamped into
     * 1–5 (a 4.6-star widget submits 5; a buggy 7 becomes 5, 0 becomes 1).
     */
    async submit(input) {
        const context = 'ReviewsClient.submit';
        const target = this.validateTarget(context, input.target);
        const authorName = (0, util_1.requireNonEmptyString)(context, 'authorName', input.authorName);
        if (typeof input.rating !== 'number' || !Number.isFinite(input.rating)) {
            (0, util_1.fail)(context, '"rating" must be a finite number (1-5)');
        }
        const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
        const review = {
            id: (0, util_1.generateId)(),
            target_type: target.type,
            target_id: target.id,
            author_name: authorName,
            rating,
            title: (0, util_1.optionalString)(context, 'title', input.title, ''),
            body: (0, util_1.optionalString)(context, 'body', input.body, ''),
            status: 'pending',
            created_at: (0, util_1.nowIso)(),
        };
        await this.ctx.query.from(exports.REVIEWS_TABLE).insert({ ...review }).execute();
        return review;
    }
    /** Approved reviews for a target, newest first. */
    async listApproved(target, options = {}) {
        const context = 'ReviewsClient.listApproved';
        const t = this.validateTarget(context, target);
        let qb = this.ctx.query
            .from(exports.REVIEWS_TABLE)
            .where('target_type', t.type)
            .where('target_id', t.id)
            .where('status', 'approved')
            .orderBy('created_at', 'DESC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    /**
     * `{count, average}` over the target's *approved* reviews.
     *
     * v0 reality (verified against the live dev runtime): the query endpoint
     * rejects SQL expressions in select columns ("invalid identifier") — the
     * only supported aggregate is the dedicated `/query/count` endpoint. So
     * count uses `.count()` and the average is computed from the rating
     * column client-side. Fine at content-site scale; switch back to one
     * aggregate SELECT once the server supports aggregate IR (tracked in the
     * platform plan).
     */
    async aggregate(target) {
        const context = 'ReviewsClient.aggregate';
        const t = this.validateTarget(context, target);
        const scoped = () => this.ctx.query
            .from(exports.REVIEWS_TABLE)
            .where('target_type', t.type)
            .where('target_id', t.id)
            .where('status', 'approved');
        const count = (0, util_1.toNumber)(await scoped().count()) ?? 0;
        if (count === 0)
            return { count: 0, average: null };
        const rows = await scoped().select('rating').rows();
        const ratings = rows
            .map((r) => (0, util_1.toNumber)(r?.rating))
            .filter((n) => n !== null && Number.isFinite(n));
        const average = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
        return { count, average };
    }
    /** Flip a review's moderation status (service key). */
    async moderate(id, status) {
        const context = 'ReviewsClient.moderate';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        if (!REVIEW_STATUSES.includes(status)) {
            (0, util_1.fail)(context, `"status" must be one of ${REVIEW_STATUSES.join(', ')} — got "${String(status)}"`);
        }
        await this.ctx.query.from(exports.REVIEWS_TABLE).update({ status }).where('id', id).execute();
    }
    // ───────── internals ─────────
    validateTarget(context, target) {
        if (!(0, util_1.isPlainObject)(target))
            (0, util_1.fail)(context, '"target" must be {type, id}');
        return {
            type: (0, util_1.requireNonEmptyString)(context, 'target.type', target.type),
            id: (0, util_1.requireNonEmptyString)(context, 'target.id', target.id),
        };
    }
}
exports.ReviewsClient = ReviewsClient;
/** The reviews module definition — wire it up via `client.modules.enable('reviews')`. */
exports.reviewsModule = (0, core_1.defineModule)({
    name: 'reviews',
    migrations: exports.REVIEWS_MIGRATIONS,
    factory: (ctx) => new ReviewsClient(ctx),
});
//# sourceMappingURL=reviews-client.js.map