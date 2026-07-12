/**
 * reviews module types. Reviews attach to an arbitrary target
 * (`target_type` + `target_id`) so one table serves products, articles,
 * venues, … without per-domain schemas.
 */

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface Review {
  id: string;
  target_type: string;
  target_id: string;
  author_name: string;
  /** Integer 1–5 (clamped/rounded on submit). */
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  created_at: string;
}

export interface ReviewTarget {
  /** e.g. 'product', 'article'. */
  type: string;
  /** The target's id in your own tables — stored as text. */
  id: string;
}

export interface SubmitReviewInput {
  target: ReviewTarget;
  authorName: string;
  rating: number;
  title?: string;
  body?: string;
}

export interface ReviewAggregate {
  /** Number of approved reviews for the target. */
  count: number;
  /** Mean approved rating, or null when there are none. */
  average: number | null;
}

export interface ListReviewsOptions {
  limit?: number;
  offset?: number;
}
