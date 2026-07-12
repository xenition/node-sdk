/**
 * events module types — events with capacity-limited RSVP (no paid
 * tickets). An event has an optional `capacity` (0 = unlimited); RSVPs
 * either land `confirmed` (seats still available) or `waitlist` (full).
 *
 * `starts_at` / `ends_at` are real `timestamptz` columns: the engine
 * accepts ISO-8601 strings bound to them (verified against the live dev
 * runtime — see events-client.ts), so callers pass ISO strings and the
 * list route can filter/order on the column directly. Only `created_at`
 * (which owns a `DEFAULT now()`) is omitted from inserts.
 */
export type EventStatus = 'draft' | 'published' | 'cancelled';
export type RsvpStatus = 'confirmed' | 'waitlist' | 'cancelled';
/** Which slice of the calendar `list()` returns. */
export type EventWhen = 'upcoming' | 'past' | 'all';
export interface EventRecord {
    id: string;
    slug: string;
    title: string;
    summary: string;
    body: string;
    /** Free-form jsonb payload: venue, location, host, image, … */
    data: Record<string, unknown>;
    /** ISO-8601. Stored in the `starts_at` timestamptz column. */
    starts_at: string;
    /** ISO-8601, or null when open-ended. */
    ends_at: string | null;
    /** Seat budget; 0 means unlimited. */
    capacity: number;
    status: EventStatus;
    created_at: string;
}
export interface CreateEventInput {
    title: string;
    /** Auto-generated from `title` (deduped) when omitted. */
    slug?: string;
    summary?: string;
    body?: string;
    data?: Record<string, unknown>;
    /** ISO-8601 timestamp — required. */
    startsAt: string;
    /** ISO-8601 timestamp — optional. */
    endsAt?: string;
    /** Seat budget; 0 (default) means unlimited. */
    capacity?: number;
    /** Defaults to 'published'. */
    status?: EventStatus;
}
export interface ListEventsOptions {
    /** 'upcoming' (default) | 'past' | 'all'. */
    when?: EventWhen;
    /** A specific status (default 'published'), or 'all' to skip the filter. */
    status?: EventStatus | 'all';
    limit?: number;
    offset?: number;
}
/**
 * Seat tallies for an event. `confirmedCount` / `waitlistCount` are seat
 * SUMS (Σ party_size), not row counts — capacity is measured in seats, so
 * summing keeps `spotsLeft` coherent. `spotsLeft` is null for unlimited
 * (capacity 0) events, otherwise `max(0, capacity - confirmedCount)`.
 */
export interface EventCounts {
    confirmedCount: number;
    waitlistCount: number;
    spotsLeft: number | null;
}
export type EventWithCounts = EventRecord & EventCounts;
export interface Rsvp {
    id: string;
    event_id: string;
    name: string;
    email: string;
    party_size: number;
    status: RsvpStatus;
    created_at: string;
}
export interface RsvpInput {
    name: string;
    email: string;
    /** 1–20; defaults to 1. */
    partySize?: number;
}
export interface ListRsvpsOptions {
    status?: RsvpStatus;
}
//# sourceMappingURL=types.d.ts.map