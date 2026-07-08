import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { ListReviewsOptions, Review, ReviewAggregate, ReviewStatus, ReviewTarget, SubmitReviewInput } from './types';
export declare const REVIEWS_TABLE = "reviews__reviews";
export declare const REVIEWS_MIGRATIONS: Migration[];
/**
 * reviews module client — moderated star ratings over `reviews__reviews`.
 *
 * `submit()` is anon-key friendly (a single INSERT, always status
 * `pending`); `moderate()` is the service-key back-office call that flips
 * pending → approved/rejected. Public surfaces (`listApproved`,
 * `aggregate`) only ever see approved rows.
 */
export declare class ReviewsClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Insert a review, status `pending`. The rating is validated to be a
     * finite number, then rounded to the nearest integer and clamped into
     * 1–5 (a 4.6-star widget submits 5; a buggy 7 becomes 5, 0 becomes 1).
     */
    submit(input: SubmitReviewInput): Promise<Review>;
    /** Approved reviews for a target, newest first. */
    listApproved(target: ReviewTarget, options?: ListReviewsOptions): Promise<Review[]>;
    /**
     * `{count, average}` over the target's *approved* reviews, computed by
     * the database (one aggregate SELECT — no row fan-out). Postgres returns
     * numerics as strings over JSON; both values are coerced here.
     */
    aggregate(target: ReviewTarget): Promise<ReviewAggregate>;
    /** Flip a review's moderation status (service key). */
    moderate(id: string, status: ReviewStatus): Promise<void>;
    private validateTarget;
}
/** The reviews module definition — wire it up via `client.modules.enable('reviews')`. */
export declare const reviewsModule: import("../core").ModuleDefinition<ReviewsClient>;
//# sourceMappingURL=reviews-client.d.ts.map