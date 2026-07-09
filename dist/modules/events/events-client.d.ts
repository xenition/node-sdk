import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { CreateEventInput, EventRecord, EventWithCounts, ListEventsOptions, ListRsvpsOptions, Rsvp, RsvpInput } from './types';
export declare const EVENTS_TABLES: {
    readonly EVENTS: "events__events";
    readonly RSVPS: "events__rsvps";
};
export declare const EVENTS_MIGRATIONS: Migration[];
/**
 * events module client — events + capacity-limited RSVP over
 * `events__events` / `events__rsvps`. No paid tickets: an RSVP is either
 * `confirmed` (seats available) or `waitlist` (full).
 *
 * `create()` / `rsvp()` are validated client-side (v0 trust model — see
 * modules/core.ts). `starts_at` / `ends_at` are stored in real timestamptz
 * columns (the engine accepts ISO strings bound to them — verified live);
 * `created_at` is the one timestamptz left to its `DEFAULT now()`, so it is
 * omitted from inserts like the reviews module does.
 */
export declare class EventsClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /** Create an event; slug auto-generated (and deduped) from the title. */
    create(input: CreateEventInput): Promise<EventRecord>;
    /**
     * List events by calendar slice:
     *   - `upcoming` (default): starts_at >= now, soonest first (ASC)
     *   - `past`: starts_at < now, most recent first (DESC)
     *   - `all`: no time filter, chronological (ASC)
     * Filtered to `status` (default 'published'); pass `status: 'all'` to skip.
     */
    list(options?: ListEventsOptions): Promise<EventRecord[]>;
    /** Fetch one event by slug, plus its live seat tallies. Null if unknown. */
    getBySlug(slug: string): Promise<EventWithCounts | null>;
    /**
     * RSVP to an event (by slug or id). Assigns `confirmed` when capacity is
     * unlimited (0) or the requested party still fits (confirmedSeats + party
     * <= capacity), otherwise `waitlist`. Returns the stored rsvp with its
     * assigned status.
     *
     * v0 note: the confirmed/waitlist decision reads the current seat sum and
     * then inserts — NOT atomic, so two simultaneous RSVPs could each see a
     * seat that only one should get. Acceptable at content-site scale; a
     * server-side transactional check is the real fix (platform plan).
     */
    rsvp(slugOrId: string, input: RsvpInput): Promise<Rsvp>;
    /** RSVPs for an event, newest first; optionally filtered by status. Service key. */
    listRsvps(eventId: string, options?: ListRsvpsOptions): Promise<Rsvp[]>;
    /** Cancel an RSVP by id (flips status to 'cancelled'). */
    cancelRsvp(id: string): Promise<void>;
    /**
     * Seat tallies. Capacity is measured in seats, so confirmed/waitlist are
     * SUMS of party_size (not row counts). The live engine rejects SQL
     * expressions in select columns (no `SUM(...)` — same limitation the
     * reviews aggregate hit), so we select the party_size column and sum
     * client-side.
     */
    private counts;
    private confirmedSeats;
    private seatSum;
    private resolveEvent;
    /**
     * Kebab slug deduped against existing rows: `mixer`, `mixer-2`, … One
     * LIKE query fetches candidates; the suffix is computed locally (mirrors
     * the cms module).
     */
    private uniqueSlug;
    private requireIso;
    private requireEmail;
    private validatePartySize;
    private validateCapacity;
    private validateStatus;
}
/** The events module definition — wire it up via `client.modules.enable('events')`. */
export declare const eventsModule: import("../core").ModuleDefinition<EventsClient>;
//# sourceMappingURL=events-client.d.ts.map