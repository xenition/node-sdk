/**
 * Data-adjacent formatting helpers shared by every template. Lives here (not
 * in the UI kit) so it sits next to the shapes it formats and stays a single
 * source of truth — templates import it alongside the client.
 */
/**
 * Format an ISO-8601 date as `Mon D, YYYY` (en-US). NaN-safe: an invalid or
 * empty input returns '' rather than 'Invalid Date', so callers can render
 * the result directly.
 */
export declare function formatDate(iso: string): string;
//# sourceMappingURL=format.d.ts.map