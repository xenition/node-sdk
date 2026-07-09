"use strict";
/**
 * Data-adjacent formatting helpers shared by every template. Lives here (not
 * in the UI kit) so it sits next to the shapes it formats and stays a single
 * source of truth — templates import it alongside the client.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDate = formatDate;
/**
 * Format an ISO-8601 date as `Mon D, YYYY` (en-US). NaN-safe: an invalid or
 * empty input returns '' rather than 'Invalid Date', so callers can render
 * the result directly.
 */
function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
//# sourceMappingURL=format.js.map