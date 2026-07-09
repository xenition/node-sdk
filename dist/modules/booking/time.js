"use strict";
/**
 * Timezone + slot math for the booking module.
 *
 * Dependency-free and DST-correct: everything is built on
 * `Intl.DateTimeFormat` (available in Node 18+ and Cloudflare Workers), so
 * the SDK core stays free of any date library. All *instants* are UTC epoch
 * milliseconds; *wall-clock* times are interpreted in a resource's IANA
 * timezone.
 *
 * The two hard operations:
 *   - `offsetMsAt(tz, utcMs)` — the zone's UTC offset at a given instant
 *     (which changes across a DST transition), and
 *   - `zonedWallToUtcMs(tz, y, mo, d, hh, mm)` — the inverse: turn a wall
 *     clock reading in the zone into the UTC instant it denotes, resolving
 *     spring-forward gaps and fall-back overlaps deterministically.
 *
 * Slot generation (see booking-client.ts) steps by *real elapsed time* from
 * a rule's start instant to its end instant. That is what makes DST fall
 * out for free: on a spring-forward day the skipped hour simply produces no
 * slot, and on a fall-back day the repeated hour produces two — no special
 * cases in the generator.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertValidTimeZone = assertValidTimeZone;
exports.offsetMsAt = offsetMsAt;
exports.localParts = localParts;
exports.zonedWallToUtcMs = zonedWallToUtcMs;
const WEEKDAY_INDEX = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};
// One formatter per zone is enough — they are pure and reused across calls.
const FORMATTER_CACHE = new Map();
function formatter(timeZone) {
    let f = FORMATTER_CACHE.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone,
            // h23 keeps midnight as 00 (some engines emit '24' with hour12:false).
            hourCycle: 'h23',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        FORMATTER_CACHE.set(timeZone, f);
    }
    return f;
}
function partsMap(timeZone, utcMs) {
    const map = {};
    for (const part of formatter(timeZone).formatToParts(new Date(utcMs))) {
        if (part.type !== 'literal')
            map[part.type] = part.value;
    }
    return map;
}
/**
 * Validate an IANA timezone id. Returns the id when the runtime recognizes
 * it, throws `RangeError` otherwise (so callers can turn it into a friendly
 * validation error).
 */
function assertValidTimeZone(timeZone) {
    // Intl throws RangeError for an unknown zone; a no-op format proves it.
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
}
/**
 * The zone's UTC offset (ms) at `utcMs`, defined so that
 * `localWallMs === utcMs + offsetMsAt(tz, utcMs)`. Negative west of UTC
 * (e.g. −5h for America/New_York in winter, −4h in summer).
 */
function offsetMsAt(timeZone, utcMs) {
    const m = partsMap(timeZone, utcMs);
    const asIfUtc = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour), Number(m.minute), Number(m.second));
    return asIfUtc - utcMs;
}
/** The civil date + weekday an instant reads as, in the given zone. */
function localParts(timeZone, utcMs) {
    const m = partsMap(timeZone, utcMs);
    return {
        year: Number(m.year),
        month: Number(m.month),
        day: Number(m.day),
        weekday: WEEKDAY_INDEX[m.weekday ?? ''] ?? 0,
    };
}
/**
 * Convert a wall-clock reading in `timeZone` to the UTC instant it denotes.
 *
 * Two-pass offset refinement: guess the offset as if the wall time were UTC,
 * subtract it, then re-read the offset at that corrected instant and apply
 * it once more. This lands the correct instant on either side of a DST
 * transition. Times that fall in a spring-forward *gap* (which never occur
 * on the clock) resolve to the post-transition instant; times in a fall-back
 * *overlap* resolve to the first (pre-transition) occurrence — both
 * deterministic and adequate for slot boundaries, which are re-derived the
 * same way on every read.
 */
function zonedWallToUtcMs(timeZone, year, month, day, hour, minute) {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const off1 = offsetMsAt(timeZone, guess);
    let utc = guess - off1;
    const off2 = offsetMsAt(timeZone, utc);
    if (off2 !== off1)
        utc = guess - off2;
    return utc;
}
//# sourceMappingURL=time.js.map