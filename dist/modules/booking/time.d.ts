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
/** Civil date + weekday (0=Sun..6=Sat) of an instant, as read in a zone. */
export interface LocalParts {
    year: number;
    month: number;
    day: number;
    weekday: number;
}
/**
 * Validate an IANA timezone id. Returns the id when the runtime recognizes
 * it, throws `RangeError` otherwise (so callers can turn it into a friendly
 * validation error).
 */
export declare function assertValidTimeZone(timeZone: string): string;
/**
 * The zone's UTC offset (ms) at `utcMs`, defined so that
 * `localWallMs === utcMs + offsetMsAt(tz, utcMs)`. Negative west of UTC
 * (e.g. −5h for America/New_York in winter, −4h in summer).
 */
export declare function offsetMsAt(timeZone: string, utcMs: number): number;
/** The civil date + weekday an instant reads as, in the given zone. */
export declare function localParts(timeZone: string, utcMs: number): LocalParts;
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
export declare function zonedWallToUtcMs(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): number;
//# sourceMappingURL=time.d.ts.map