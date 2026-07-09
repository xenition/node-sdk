/**
 * booking module types — availability-based slot scheduling (the real
 * reliability primitive that upgrades a service site from "booking request"
 * to genuine slot booking). No payments here: deposits/checkout are a later
 * commerce wave.
 *
 * A `resource` (a person, room, table, or piece of equipment) publishes
 * weekly `availability` rules in its own IANA `timezone`; `searchSlots`
 * expands those rules into concrete, DST-correct UTC slots, subtracting
 * blackouts and slots already at capacity. `book` re-derives the same
 * availability before inserting a `confirmed` booking, so a slot can only be
 * taken when it is genuinely open.
 *
 * Timestamptz columns (`starts_at` / `ends_at`) are stored as real
 * `timestamptz` and accept ISO-8601 strings bound to them (the same live
 * behaviour the events module relies on). Only `created_at` (a
 * `DEFAULT now()`) is omitted from inserts.
 */

export type ResourceStatus = 'active' | 'inactive';

export type BookingStatus = 'confirmed' | 'cancelled';

/**
 * One weekly availability rule: the resource is open on `weekday`
 * (0=Sunday..6=Saturday) from `start` to `end`, each a `HH:MM` wall-clock
 * time in the resource's timezone (`end` may be `24:00` for a window that
 * runs to midnight). A resource carries an array of these.
 */
export interface AvailabilityRule {
  /** 0=Sunday .. 6=Saturday. */
  weekday: number;
  /** `HH:MM` (00:00–23:59), resource-local wall clock. */
  start: string;
  /** `HH:MM` (00:01–24:00), resource-local wall clock; must be > `start`. */
  end: string;
}

export interface BookingResource {
  id: string;
  slug: string;
  name: string;
  /** Free-form kind: 'service', 'room', 'table', 'staff', … */
  type: string;
  /** IANA timezone id (e.g. 'America/New_York'). */
  timezone: string;
  /** Concurrent capacity per slot (>=1; group classes/tables use >1). */
  capacity: number;
  /** Slot length in minutes. */
  slot_minutes: number;
  /** Gap enforced after each slot before the next can start. */
  buffer_minutes: number;
  /** How far ahead of now a slot must be to be bookable. */
  min_notice_minutes: number;
  /** How far into the future bookings are allowed. */
  max_advance_days: number;
  /** Weekly availability rules. */
  availability: AvailabilityRule[];
  /** Free-form jsonb payload: description, price hint, location, … */
  data: Record<string, unknown>;
  status: ResourceStatus;
  created_at: string;
}

export interface CreateResourceInput {
  name: string;
  /** Auto-generated from `name` (deduped) when omitted. */
  slug?: string;
  /** Defaults to 'service'. */
  type?: string;
  /** IANA timezone; defaults to 'UTC'. */
  timezone?: string;
  /** Defaults to 1. Must be >= 1. */
  capacity?: number;
  /** Defaults to 30. */
  slotMinutes?: number;
  /** Defaults to 0. */
  bufferMinutes?: number;
  /** Defaults to 0. */
  minNoticeMinutes?: number;
  /** Defaults to 60. */
  maxAdvanceDays?: number;
  /** Weekly rules; defaults to []. */
  availability?: AvailabilityRule[];
  data?: Record<string, unknown>;
  /** Defaults to 'active'. */
  status?: ResourceStatus;
}

/** Every field optional — only the keys present are updated. Service key. */
export interface UpdateResourceInput {
  name?: string;
  slug?: string;
  type?: string;
  timezone?: string;
  capacity?: number;
  slotMinutes?: number;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  maxAdvanceDays?: number;
  availability?: AvailabilityRule[];
  data?: Record<string, unknown>;
  status?: ResourceStatus;
}

export interface ListResourcesOptions {
  /** A specific status (default 'active'), or 'all' to skip the filter. */
  status?: ResourceStatus | 'all';
}

export interface Blackout {
  id: string;
  resource_id: string;
  /** ISO-8601. */
  starts_at: string;
  /** ISO-8601. */
  ends_at: string;
  reason: string;
  created_at: string;
}

export interface AddBlackoutInput {
  /** ISO-8601 timestamp — required. */
  startsAt: string;
  /** ISO-8601 timestamp — required, must be after `startsAt`. */
  endsAt: string;
  /** Optional human note (holiday, closure, …). */
  reason?: string;
}

export interface Booking {
  id: string;
  resource_id: string;
  customer_name: string;
  customer_email: string;
  /** ISO-8601; the slot start. */
  starts_at: string;
  /** ISO-8601; `starts_at` + `slot_minutes`. */
  ends_at: string;
  party_size: number;
  status: BookingStatus;
  notes: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface BookInput {
  /** ISO-8601 slot start; must match a real, open slot. */
  startsAt: string;
  customerName: string;
  customerEmail: string;
  /** Seats requested within the slot's capacity; defaults to 1. */
  partySize?: number;
  notes?: string;
  data?: Record<string, unknown>;
}

/** Window to expand availability over. Both ISO-8601; `to` must be after `from`. */
export interface SearchSlotsOptions {
  from: string;
  to: string;
}

/** A concrete bookable slot. `spotsLeft` is capacity minus confirmed seats. */
export interface Slot {
  /** ISO-8601 (UTC). */
  startsAt: string;
  /** ISO-8601 (UTC). */
  endsAt: string;
  spotsLeft: number;
}

export interface ListBookingsOptions {
  /** ISO-8601 lower bound on `starts_at` (inclusive). */
  from?: string;
  /** ISO-8601 upper bound on `starts_at` (exclusive). */
  to?: string;
  status?: BookingStatus;
}
