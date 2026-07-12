import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { AddBlackoutInput, Blackout, BookInput, Booking, BookingResource, CreateResourceInput, ListBookingsOptions, ListResourcesOptions, SearchSlotsOptions, Slot, UpdateResourceInput } from './types';
export declare const BOOKING_TABLES: {
    readonly RESOURCES: "booking__resources";
    readonly BLACKOUTS: "booking__blackouts";
    readonly BOOKINGS: "booking__bookings";
};
export declare const BOOKING_MIGRATIONS: Migration[];
/**
 * booking module client — availability-based slot scheduling over
 * `booking__resources` / `booking__blackouts` / `booking__bookings`.
 *
 * The heart of the module is `searchSlots`: it expands a resource's weekly
 * `availability` rules into concrete UTC slots across a window, honouring
 * `slot_minutes` granularity, `buffer_minutes` spacing, `min_notice_minutes`
 * / `max_advance_days` bounds, blackout exceptions, and per-slot capacity
 * (summing `party_size` of overlapping confirmed bookings). It is
 * DST-correct: slots are stepped by real elapsed time between a rule's
 * start/end instants (see time.ts), so a spring-forward day drops the
 * skipped hour and a fall-back day keeps the repeated one, with no special
 * cases. `book` re-derives the very same availability before inserting, so a
 * slot can only be taken while it is genuinely open.
 *
 * v0 trust/race model (see modules/core.ts): writes are validated
 * client-side, and the capacity check for group resources (capacity>1) is a
 * read-then-insert — two simultaneous bookings could each see the last seat.
 * Acceptable at service-site scale. Capacity=1 resources get a hard DB guard
 * via the partial unique `slot_lock` index (migration 0006), so the common
 * 1:1 case cannot double-book even under a race; the loser surfaces as
 * `SLOT_UNAVAILABLE`.
 */
export declare class BookingClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /** Create a bookable resource; slug auto-generated (deduped) from the name. */
    createResource(input: CreateResourceInput): Promise<BookingResource>;
    /** Fetch one resource by slug. Null if unknown. */
    getResource(slug: string): Promise<BookingResource | null>;
    /**
     * List resources, filtered by status (default 'active'); pass
     * `status: 'all'` to skip the filter. Ordered by name.
     */
    listResources(options?: ListResourcesOptions): Promise<BookingResource[]>;
    /** Patch a resource (service key). Only the fields present are updated. */
    updateResource(id: string, patch: UpdateResourceInput): Promise<void>;
    /** Add an availability exception (holiday/closure) to a resource. */
    addBlackout(resourceId: string, input: AddBlackoutInput): Promise<Blackout>;
    /** Blackouts for a resource, earliest first. */
    listBlackouts(resourceId: string): Promise<Blackout[]>;
    /**
     * Expand a resource's weekly availability into concrete, DST-correct UTC
     * slots across `[from, to)`, subtracting blackouts and slots already at
     * capacity. Returns `{startsAt, endsAt, spotsLeft}[]` ordered by start.
     * An inactive resource (or one with no rules) yields no slots.
     */
    searchSlots(slug: string, options: SearchSlotsOptions): Promise<Slot[]>;
    /**
     * Book a slot. Re-derives the resource's availability for the requested
     * instant, verifies the slot is real and has room for `partySize`, then
     * inserts a `confirmed` booking (ends_at = startsAt + slot_minutes). Throws
     * `SLOT_UNAVAILABLE` when the slot is not a real open slot, or when a
     * capacity=1 race is lost at the DB unique guard.
     */
    book(slug: string, input: BookInput): Promise<Booking>;
    /** Cancel a booking by id (flips status to 'cancelled', freeing the slot). */
    cancel(bookingId: string): Promise<void>;
    /**
     * Bookings for a resource (service key), earliest first; optionally
     * filtered by `[from, to)` on starts_at and/or status.
     */
    listBookings(resourceId: string, options?: ListBookingsOptions): Promise<Booking[]>;
    /**
     * Pure slot expansion. For each local calendar day in the window, each
     * matching weekly rule is turned into a start/end *instant* (DST-correct),
     * then stepped by `slot_minutes + buffer_minutes` of REAL time — which is
     * what makes DST transitions fall out for free. Each candidate is filtered
     * by the window, min-notice/max-advance bounds, blackouts, and capacity.
     */
    private computeSlots;
    /** Fetch confirmed bookings + blackouts overlapping `[fromMs, toMs)`. */
    private loadWindow;
    /** Row → interval. Reads snake_case OR camelCase keys (runtimes differ). */
    private toInterval;
    private uniqueSlug;
    /**
     * Coerce a raw resource row into a typed `BookingResource`: numbers may
     * arrive as strings, and `availability` may arrive as a JSON string (some
     * runtimes stringify jsonb). Defensive on both fronts.
     */
    private hydrateResource;
    private coerceAvailability;
    private validateAvailability;
    private parseHhMm;
    private validateInt;
    private validateResourceStatus;
    private validateTimeZone;
    private requireIso;
    private requireIsoMs;
    private requireEmail;
    private slotUnavailable;
    private isConflict;
}
/** The booking module definition — wire it up via `client.modules.enable('booking')`. */
export declare const bookingModule: import("../core").ModuleDefinition<BookingClient>;
//# sourceMappingURL=booking-client.d.ts.map