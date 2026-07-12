import { XenitionError } from '../../core/errors';
import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import {
  fail,
  generateId,
  isPlainObject,
  nowIso,
  optionalPlainObject,
  optionalString,
  requireNonEmptyString,
  slugify,
  toNumber,
} from '../util';
import { localParts, offsetMsAt, zonedWallToUtcMs, assertValidTimeZone } from './time';
import {
  AddBlackoutInput,
  AvailabilityRule,
  Blackout,
  BookInput,
  Booking,
  BookingResource,
  BookingStatus,
  CreateResourceInput,
  ListBookingsOptions,
  ListResourcesOptions,
  ResourceStatus,
  SearchSlotsOptions,
  Slot,
  UpdateResourceInput,
} from './types';

export const BOOKING_TABLES = {
  RESOURCES: 'booking__resources',
  BLACKOUTS: 'booking__blackouts',
  BOOKINGS: 'booking__bookings',
} as const;

export const BOOKING_MIGRATIONS: Migration[] = [
  {
    id: 'booking/0001_create_booking__resources',
    sql: `CREATE TABLE IF NOT EXISTS ${BOOKING_TABLES.RESOURCES} (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'service',
  timezone text NOT NULL DEFAULT 'UTC',
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  slot_minutes integer NOT NULL DEFAULT 30 CHECK (slot_minutes >= 1),
  buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  min_notice_minutes integer NOT NULL DEFAULT 0 CHECK (min_notice_minutes >= 0),
  max_advance_days integer NOT NULL DEFAULT 60 CHECK (max_advance_days >= 1),
  availability jsonb NOT NULL DEFAULT '[]'::jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'booking/0002_create_booking__blackouts',
    sql: `CREATE TABLE IF NOT EXISTS ${BOOKING_TABLES.BLACKOUTS} (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'booking/0003_index_booking__blackouts_resource',
    sql: `CREATE INDEX IF NOT EXISTS booking__blackouts_resource_idx ON ${BOOKING_TABLES.BLACKOUTS} (resource_id, starts_at)`,
  },
  {
    id: 'booking/0004_create_booking__bookings',
    sql: `CREATE TABLE IF NOT EXISTS ${BOOKING_TABLES.BOOKINGS} (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size >= 1),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  notes text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  slot_lock text,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'booking/0005_index_booking__bookings_resource',
    sql: `CREATE INDEX IF NOT EXISTS booking__bookings_resource_idx ON ${BOOKING_TABLES.BOOKINGS} (resource_id, status, starts_at)`,
  },
  {
    // Hard, DB-level double-booking guard for the capacity=1 common case.
    // `slot_lock` is set to the slot's ISO start ONLY when the resource has
    // capacity 1 (NULL for group resources, whose overlaps are checked in
    // code). Partial + NULL-distinct, so two CONFIRMED exclusive bookings on
    // the same resource+slot collide, while group bookings (NULL) never do,
    // and a cancelled row (status<>'confirmed') frees the slot for rebooking.
    id: 'booking/0006_unique_booking__bookings_slot_lock',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS booking__bookings_slot_lock_uidx ON ${BOOKING_TABLES.BOOKINGS} (resource_id, slot_lock) WHERE status = 'confirmed' AND slot_lock IS NOT NULL`,
  },
];

const RESOURCE_STATUSES: ResourceStatus[] = ['active', 'inactive'];
const BOOKING_STATUSES: BookingStatus[] = ['confirmed', 'cancelled'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
/** Guardrail so a runaway `searchSlots` window can't fan out unboundedly. */
const MAX_SEARCH_WINDOW_DAYS = 366;

/** Marker text that the router maps to a 409. */
const SLOT_UNAVAILABLE = 'SLOT_UNAVAILABLE';

interface Interval {
  startMs: number;
  endMs: number;
  party: number;
}

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
export class BookingClient {
  constructor(private readonly ctx: ModuleContext) {}

  // ───────── resources ─────────

  /** Create a bookable resource; slug auto-generated (deduped) from the name. */
  async createResource(input: CreateResourceInput): Promise<BookingResource> {
    const context = 'BookingClient.createResource';
    const name = requireNonEmptyString(context, 'name', input.name);
    const type = optionalString(context, 'type', input.type, 'service');
    const timezone = this.validateTimeZone(context, input.timezone, 'UTC');
    const capacity = this.validateInt(context, 'capacity', input.capacity, 1, 1);
    const slotMinutes = this.validateInt(context, 'slotMinutes', input.slotMinutes, 30, 1);
    const bufferMinutes = this.validateInt(context, 'bufferMinutes', input.bufferMinutes, 0, 0);
    const minNoticeMinutes = this.validateInt(context, 'minNoticeMinutes', input.minNoticeMinutes, 0, 0);
    const maxAdvanceDays = this.validateInt(context, 'maxAdvanceDays', input.maxAdvanceDays, 60, 1);
    const availability = this.validateAvailability(context, input.availability, []);
    const data = optionalPlainObject(context, 'data', input.data, {});
    const status = this.validateResourceStatus(context, input.status, 'active');
    const slug =
      input.slug !== undefined
        ? requireNonEmptyString(context, 'slug', input.slug)
        : await this.uniqueSlug(slugify(name));

    const resource: BookingResource = {
      id: generateId(),
      slug,
      name,
      type,
      timezone,
      capacity,
      slot_minutes: slotMinutes,
      buffer_minutes: bufferMinutes,
      min_notice_minutes: minNoticeMinutes,
      max_advance_days: maxAdvanceDays,
      availability,
      data,
      status,
      created_at: nowIso(),
    };
    // created_at is OWNED by the column default (now()) — omit it from the
    // wire insert (same as events/reviews). availability/data are jsonb and
    // sent as the array/object directly (the engine binds jsonb natively).
    const { created_at: _omitted, ...row } = resource;
    await this.ctx.query.from(BOOKING_TABLES.RESOURCES).insert(row).execute();
    return resource;
  }

  /** Fetch one resource by slug. Null if unknown. */
  async getResource(slug: string): Promise<BookingResource | null> {
    const context = 'BookingClient.getResource';
    requireNonEmptyString(context, 'slug', slug);
    const row = await this.ctx.query
      .from(BOOKING_TABLES.RESOURCES)
      .where('slug', slug)
      .first<Record<string, unknown>>();
    return row ? this.hydrateResource(row) : null;
  }

  /**
   * List resources, filtered by status (default 'active'); pass
   * `status: 'all'` to skip the filter. Ordered by name.
   */
  async listResources(options: ListResourcesOptions = {}): Promise<BookingResource[]> {
    const context = 'BookingClient.listResources';
    const status = options.status ?? 'active';
    let qb = this.ctx.query.from(BOOKING_TABLES.RESOURCES);
    if (status !== 'all') {
      if (!RESOURCE_STATUSES.includes(status as ResourceStatus)) {
        fail(context, `"status" must be one of ${RESOURCE_STATUSES.join(', ')}, all — got "${String(status)}"`);
      }
      qb = qb.where('status', status);
    }
    const rows = await qb.orderBy('name', 'ASC').rows<Record<string, unknown>>();
    return rows.map((row) => this.hydrateResource(row));
  }

  /** Patch a resource (service key). Only the fields present are updated. */
  async updateResource(id: string, patch: UpdateResourceInput): Promise<void> {
    const context = 'BookingClient.updateResource';
    requireNonEmptyString(context, 'id', id);
    if (!isPlainObject(patch)) fail(context, 'patch must be a plain object');
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = requireNonEmptyString(context, 'name', patch.name);
    if (patch.slug !== undefined) data.slug = requireNonEmptyString(context, 'slug', patch.slug);
    if (patch.type !== undefined) data.type = optionalString(context, 'type', patch.type, 'service');
    if (patch.timezone !== undefined) data.timezone = this.validateTimeZone(context, patch.timezone, 'UTC');
    if (patch.capacity !== undefined) data.capacity = this.validateInt(context, 'capacity', patch.capacity, 1, 1);
    if (patch.slotMinutes !== undefined) data.slot_minutes = this.validateInt(context, 'slotMinutes', patch.slotMinutes, 30, 1);
    if (patch.bufferMinutes !== undefined) data.buffer_minutes = this.validateInt(context, 'bufferMinutes', patch.bufferMinutes, 0, 0);
    if (patch.minNoticeMinutes !== undefined) data.min_notice_minutes = this.validateInt(context, 'minNoticeMinutes', patch.minNoticeMinutes, 0, 0);
    if (patch.maxAdvanceDays !== undefined) data.max_advance_days = this.validateInt(context, 'maxAdvanceDays', patch.maxAdvanceDays, 60, 1);
    if (patch.availability !== undefined) data.availability = this.validateAvailability(context, patch.availability, []);
    if (patch.data !== undefined) data.data = optionalPlainObject(context, 'data', patch.data, {});
    if (patch.status !== undefined) data.status = this.validateResourceStatus(context, patch.status, 'active');
    if (Object.keys(data).length === 0) fail(context, 'patch must set at least one field');
    await this.ctx.query.from(BOOKING_TABLES.RESOURCES).update(data).where('id', id).execute();
  }

  // ───────── blackouts ─────────

  /** Add an availability exception (holiday/closure) to a resource. */
  async addBlackout(resourceId: string, input: AddBlackoutInput): Promise<Blackout> {
    const context = 'BookingClient.addBlackout';
    requireNonEmptyString(context, 'resourceId', resourceId);
    const startsAt = this.requireIso(context, 'startsAt', input.startsAt);
    const endsAt = this.requireIso(context, 'endsAt', input.endsAt);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      fail(context, '"endsAt" must be after "startsAt"');
    }
    const reason = optionalString(context, 'reason', input.reason, '');
    const blackout: Blackout = {
      id: generateId(),
      resource_id: resourceId,
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
      created_at: nowIso(),
    };
    // created_at owned by the DB default — omit it. starts_at/ends_at ARE
    // sent as ISO strings (real timestamptz columns; see events).
    const { created_at: _omitted, ...row } = blackout;
    await this.ctx.query.from(BOOKING_TABLES.BLACKOUTS).insert(row).execute();
    return blackout;
  }

  /** Blackouts for a resource, earliest first. */
  async listBlackouts(resourceId: string): Promise<Blackout[]> {
    const context = 'BookingClient.listBlackouts';
    requireNonEmptyString(context, 'resourceId', resourceId);
    return this.ctx.query
      .from(BOOKING_TABLES.BLACKOUTS)
      .where('resource_id', resourceId)
      .orderBy('starts_at', 'ASC')
      .rows<Blackout>();
  }

  // ───────── slots ─────────

  /**
   * Expand a resource's weekly availability into concrete, DST-correct UTC
   * slots across `[from, to)`, subtracting blackouts and slots already at
   * capacity. Returns `{startsAt, endsAt, spotsLeft}[]` ordered by start.
   * An inactive resource (or one with no rules) yields no slots.
   */
  async searchSlots(slug: string, options: SearchSlotsOptions): Promise<Slot[]> {
    const context = 'BookingClient.searchSlots';
    const fromMs = this.requireIsoMs(context, 'from', options?.from);
    const toMs = this.requireIsoMs(context, 'to', options?.to);
    if (toMs <= fromMs) fail(context, '"to" must be after "from"');
    if (toMs - fromMs > MAX_SEARCH_WINDOW_DAYS * MS_PER_DAY) {
      fail(context, `search window must be at most ${MAX_SEARCH_WINDOW_DAYS} days`);
    }
    const resource = await this.getResource(slug);
    if (!resource) fail(context, `unknown resource "${slug}"`);
    if (resource.status !== 'active' || resource.availability.length === 0) return [];

    const { confirmed, blackouts } = await this.loadWindow(resource.id, fromMs, toMs);
    return this.computeSlots(resource, fromMs, toMs, confirmed, blackouts, Date.now());
  }

  // ───────── bookings ─────────

  /**
   * Book a slot. Re-derives the resource's availability for the requested
   * instant, verifies the slot is real and has room for `partySize`, then
   * inserts a `confirmed` booking (ends_at = startsAt + slot_minutes). Throws
   * `SLOT_UNAVAILABLE` when the slot is not a real open slot, or when a
   * capacity=1 race is lost at the DB unique guard.
   */
  async book(slug: string, input: BookInput): Promise<Booking> {
    const context = 'BookingClient.book';
    const startsAtMs = this.requireIsoMs(context, 'startsAt', input.startsAt);
    const customerName = requireNonEmptyString(context, 'customerName', input.customerName);
    const customerEmail = this.requireEmail(context, input.customerEmail);
    const partySize = this.validateInt(context, 'partySize', input.partySize, 1, 1);
    const notes = optionalString(context, 'notes', input.notes, '');
    const data = optionalPlainObject(context, 'data', input.data, {});

    const resource = await this.getResource(slug);
    if (!resource) fail(context, `unknown resource "${slug}"`);
    if (resource.status !== 'active') this.slotUnavailable(context, 'resource is not active');

    const slotMs = resource.slot_minutes * MS_PER_MINUTE;
    const endMs = startsAtMs + slotMs;
    // Load overlapping bookings/blackouts for just this slot window, then let
    // computeSlots re-derive the availability grid; the exact-start filter
    // keeps only the requested slot.
    const { confirmed, blackouts } = await this.loadWindow(resource.id, startsAtMs, endMs);
    const slots = this.computeSlots(resource, startsAtMs, startsAtMs + 1, confirmed, blackouts, Date.now());
    const slot = slots.find((s) => Date.parse(s.startsAt) === startsAtMs);
    if (!slot) this.slotUnavailable(context, 'the requested time is not an open slot');
    if (slot.spotsLeft < partySize) this.slotUnavailable(context, 'the slot does not have enough capacity');

    const startsAt = new Date(startsAtMs).toISOString();
    const booking: Booking = {
      id: generateId(),
      resource_id: resource.id,
      customer_name: customerName,
      customer_email: customerEmail,
      starts_at: startsAt,
      ends_at: slot.endsAt,
      party_size: partySize,
      status: 'confirmed',
      notes,
      data,
      created_at: nowIso(),
    };
    // created_at owned by the DB default — omit it. starts_at/ends_at sent as
    // ISO strings (timestamptz). slot_lock materializes the capacity=1
    // exclusivity so the partial unique index (0006) can enforce it; group
    // resources (capacity>1) leave it NULL and rely on the code-side count.
    const { created_at: _omitted, ...rest } = booking;
    const row: Record<string, unknown> = { ...rest };
    if (resource.capacity === 1) row.slot_lock = startsAt;
    try {
      await this.ctx.query.from(BOOKING_TABLES.BOOKINGS).insert(row).execute();
    } catch (err) {
      // The DB unique guard fired — someone else took the capacity=1 slot
      // between our read and our insert. Surface it as SLOT_UNAVAILABLE.
      if (this.isConflict(err)) this.slotUnavailable(context, 'the slot was just taken');
      throw err;
    }
    return booking;
  }

  /** Cancel a booking by id (flips status to 'cancelled', freeing the slot). */
  async cancel(bookingId: string): Promise<void> {
    const context = 'BookingClient.cancel';
    requireNonEmptyString(context, 'bookingId', bookingId);
    await this.ctx.query
      .from(BOOKING_TABLES.BOOKINGS)
      .update({ status: 'cancelled' })
      .where('id', bookingId)
      .execute();
  }

  /**
   * Bookings for a resource (service key), earliest first; optionally
   * filtered by `[from, to)` on starts_at and/or status.
   */
  async listBookings(resourceId: string, options: ListBookingsOptions = {}): Promise<Booking[]> {
    const context = 'BookingClient.listBookings';
    requireNonEmptyString(context, 'resourceId', resourceId);
    let qb = this.ctx.query.from(BOOKING_TABLES.BOOKINGS).where('resource_id', resourceId);
    if (options.status !== undefined) {
      if (!BOOKING_STATUSES.includes(options.status)) {
        fail(context, `"status" must be one of ${BOOKING_STATUSES.join(', ')} — got "${String(options.status)}"`);
      }
      qb = qb.where('status', options.status);
    }
    if (options.from !== undefined) {
      qb = qb.where('starts_at', '>=', this.requireIso(context, 'from', options.from));
    }
    if (options.to !== undefined) {
      qb = qb.where('starts_at', '<', this.requireIso(context, 'to', options.to));
    }
    return qb.orderBy('starts_at', 'ASC').rows<Booking>();
  }

  // ───────── slot generation (the core) ─────────

  /**
   * Pure slot expansion. For each local calendar day in the window, each
   * matching weekly rule is turned into a start/end *instant* (DST-correct),
   * then stepped by `slot_minutes + buffer_minutes` of REAL time — which is
   * what makes DST transitions fall out for free. Each candidate is filtered
   * by the window, min-notice/max-advance bounds, blackouts, and capacity.
   */
  private computeSlots(
    resource: BookingResource,
    fromMs: number,
    toMs: number,
    confirmed: Interval[],
    blackouts: Interval[],
    nowMs: number,
  ): Slot[] {
    const tz = resource.timezone;
    const capacity = resource.capacity;
    const slotMs = resource.slot_minutes * MS_PER_MINUTE;
    const stepMs = (resource.slot_minutes + resource.buffer_minutes) * MS_PER_MINUTE;
    const earliest = nowMs + resource.min_notice_minutes * MS_PER_MINUTE;
    const latest = nowMs + resource.max_advance_days * MS_PER_DAY;

    // Enumerate local civil dates covering the window. A civil date is
    // represented as a UTC midnight so `+1 day` always advances one calendar
    // day and `getUTCDay()` gives that date's weekday.
    const startDate = localParts(tz, fromMs);
    const endDate = localParts(tz, toMs);
    const firstDayMs = Date.UTC(startDate.year, startDate.month - 1, startDate.day);
    const lastDayMs = Date.UTC(endDate.year, endDate.month - 1, endDate.day);

    const out: Array<Slot & { _startMs: number }> = [];
    const seen = new Set<number>();

    for (let dayMs = firstDayMs; dayMs <= lastDayMs; dayMs += MS_PER_DAY) {
      const civil = new Date(dayMs);
      const y = civil.getUTCFullYear();
      const mo = civil.getUTCMonth() + 1;
      const d = civil.getUTCDate();
      const weekday = civil.getUTCDay();
      for (const rule of resource.availability) {
        if (rule.weekday !== weekday) continue;
        const [sh, sm] = this.parseHhMm(rule.start);
        const [eh, em] = this.parseHhMm(rule.end);
        const ruleStart = zonedWallToUtcMs(tz, y, mo, d, sh, sm);
        const ruleEnd = zonedWallToUtcMs(tz, y, mo, d, eh, em);
        for (let s = ruleStart; s + slotMs <= ruleEnd; s += stepMs) {
          const e = s + slotMs;
          if (s < fromMs || s >= toMs) continue;
          if (s < earliest || s > latest) continue;
          if (seen.has(s)) continue;
          if (blackouts.some((b) => s < b.endMs && e > b.startMs)) continue;
          let taken = 0;
          for (const b of confirmed) {
            if (b.startMs < e && b.endMs > s) taken += b.party;
          }
          const spotsLeft = capacity - taken;
          if (spotsLeft <= 0) continue;
          seen.add(s);
          out.push({
            _startMs: s,
            startsAt: new Date(s).toISOString(),
            endsAt: new Date(e).toISOString(),
            spotsLeft,
          });
        }
      }
    }
    out.sort((a, b) => a._startMs - b._startMs);
    return out.map(({ _startMs, ...slot }) => slot);
  }

  /** Fetch confirmed bookings + blackouts overlapping `[fromMs, toMs)`. */
  private async loadWindow(
    resourceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<{ confirmed: Interval[]; blackouts: Interval[] }> {
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    // Overlap: starts before the window end AND ends after the window start.
    const [bookingRows, blackoutRows] = await Promise.all([
      this.ctx.query
        .from(BOOKING_TABLES.BOOKINGS)
        .where('resource_id', resourceId)
        .where('status', 'confirmed')
        .where('starts_at', '<', toIso)
        .where('ends_at', '>', fromIso)
        .rows<Record<string, unknown>>(),
      this.ctx.query
        .from(BOOKING_TABLES.BLACKOUTS)
        .where('resource_id', resourceId)
        .where('starts_at', '<', toIso)
        .where('ends_at', '>', fromIso)
        .rows<Record<string, unknown>>(),
    ]);
    return {
      confirmed: bookingRows
        .map((r) => this.toInterval(r, true))
        .filter((i): i is Interval => i !== null),
      blackouts: blackoutRows
        .map((r) => this.toInterval(r, false))
        .filter((i): i is Interval => i !== null),
    };
  }

  /** Row → interval. Reads snake_case OR camelCase keys (runtimes differ). */
  private toInterval(row: Record<string, unknown>, withParty: boolean): Interval | null {
    const startVal = row.starts_at ?? row.startsAt;
    const endVal = row.ends_at ?? row.endsAt;
    const startMs = typeof startVal === 'string' ? Date.parse(startVal) : NaN;
    const endMs = typeof endVal === 'string' ? Date.parse(endVal) : NaN;
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
    const party = withParty ? toNumber(row.party_size ?? row.partySize) ?? 1 : 1;
    return { startMs, endMs, party };
  }

  // ───────── internals ─────────

  private async uniqueSlug(base: string): Promise<string> {
    const rows = await this.ctx.query
      .from(BOOKING_TABLES.RESOURCES)
      .select('slug')
      .whereLike('slug', `${base}%`)
      .rows<{ slug: string }>();
    const taken = new Set(rows.map((row) => row.slug));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  /**
   * Coerce a raw resource row into a typed `BookingResource`: numbers may
   * arrive as strings, and `availability` may arrive as a JSON string (some
   * runtimes stringify jsonb). Defensive on both fronts.
   */
  private hydrateResource(row: Record<string, unknown>): BookingResource {
    const get = (snake: string, camel: string): unknown => row[snake] ?? row[camel];
    return {
      id: String(get('id', 'id') ?? ''),
      slug: String(get('slug', 'slug') ?? ''),
      name: String(get('name', 'name') ?? ''),
      type: String(get('type', 'type') ?? 'service'),
      timezone: String(get('timezone', 'timezone') ?? 'UTC'),
      capacity: toNumber(get('capacity', 'capacity')) ?? 1,
      slot_minutes: toNumber(get('slot_minutes', 'slotMinutes')) ?? 30,
      buffer_minutes: toNumber(get('buffer_minutes', 'bufferMinutes')) ?? 0,
      min_notice_minutes: toNumber(get('min_notice_minutes', 'minNoticeMinutes')) ?? 0,
      max_advance_days: toNumber(get('max_advance_days', 'maxAdvanceDays')) ?? 60,
      availability: this.coerceAvailability(get('availability', 'availability')),
      data: (isPlainObject(get('data', 'data')) ? get('data', 'data') : {}) as Record<string, unknown>,
      status: (get('status', 'status') === 'inactive' ? 'inactive' : 'active') as ResourceStatus,
      created_at: String(get('created_at', 'createdAt') ?? ''),
    };
  }

  private coerceAvailability(value: unknown): AvailabilityRule[] {
    let arr: unknown = value;
    if (typeof arr === 'string') {
      try {
        arr = JSON.parse(arr);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(arr)) return [];
    const out: AvailabilityRule[] = [];
    for (const item of arr) {
      if (!isPlainObject(item)) continue;
      const weekday = toNumber(item.weekday);
      const start = item.start;
      const end = item.end;
      if (weekday === null || typeof start !== 'string' || typeof end !== 'string') continue;
      out.push({ weekday, start, end });
    }
    return out;
  }

  private validateAvailability(
    context: string,
    value: unknown,
    fallback: AvailabilityRule[],
  ): AvailabilityRule[] {
    if (value === undefined) return fallback;
    if (!Array.isArray(value)) fail(context, '"availability" must be an array of weekly rules');
    return value.map((item, i) => {
      if (!isPlainObject(item)) fail(context, `"availability[${i}]" must be an object`);
      const weekday = toNumber(item.weekday);
      if (weekday === null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        fail(context, `"availability[${i}].weekday" must be an integer 0-6`);
      }
      const start = item.start;
      const end = item.end;
      if (typeof start !== 'string' || !HHMM_RE.test(start)) {
        fail(context, `"availability[${i}].start" must be "HH:MM"`);
      }
      if (typeof end !== 'string' || !HHMM_RE.test(end)) {
        fail(context, `"availability[${i}].end" must be "HH:MM"`);
      }
      const [sh, sm] = this.parseHhMm(start);
      const [eh, em] = this.parseHhMm(end);
      if (eh * 60 + em <= sh * 60 + sm) {
        fail(context, `"availability[${i}].end" must be after "start"`);
      }
      return { weekday, start, end };
    });
  }

  private parseHhMm(value: string): [number, number] {
    const m = HHMM_RE.exec(value);
    if (!m) return [0, 0];
    return [Number(m[1]), Number(m[2])];
  }

  private validateInt(
    context: string,
    field: string,
    value: unknown,
    fallback: number,
    min: number,
  ): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      fail(context, `"${field}" must be an integer >= ${min}`);
    }
    return value;
  }

  private validateResourceStatus(
    context: string,
    value: unknown,
    fallback: ResourceStatus,
  ): ResourceStatus {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !RESOURCE_STATUSES.includes(value as ResourceStatus)) {
      fail(context, `"status" must be one of ${RESOURCE_STATUSES.join(', ')} — got "${String(value)}"`);
    }
    return value as ResourceStatus;
  }

  private validateTimeZone(context: string, value: unknown, fallback: string): string {
    if (value === undefined) return fallback;
    const tz = requireNonEmptyString(context, 'timezone', value);
    try {
      assertValidTimeZone(tz);
    } catch {
      fail(context, `"timezone" must be a valid IANA timezone — got "${tz}"`);
    }
    return tz;
  }

  private requireIso(context: string, field: string, value: unknown): string {
    const str = requireNonEmptyString(context, field, value);
    if (Number.isNaN(Date.parse(str))) {
      fail(context, `"${field}" must be an ISO-8601 date string — got "${str}"`);
    }
    return str;
  }

  private requireIsoMs(context: string, field: string, value: unknown): number {
    return Date.parse(this.requireIso(context, field, value));
  }

  private requireEmail(context: string, value: unknown): string {
    const email = requireNonEmptyString(context, 'customerEmail', value);
    if (!EMAIL_RE.test(email)) fail(context, '"customerEmail" must be a valid email address');
    return email;
  }

  private slotUnavailable(context: string, why: string): never {
    fail(context, `${SLOT_UNAVAILABLE} — ${why}`);
  }

  private isConflict(err: unknown): boolean {
    if (err instanceof XenitionError && err.code === 'CONFLICT') return true;
    return err instanceof Error && /duplicate|unique|conflict/i.test(err.message);
  }
}

/** The booking module definition — wire it up via `client.modules.enable('booking')`. */
export const bookingModule = defineModule({
  name: 'booking',
  migrations: BOOKING_MIGRATIONS,
  factory: (ctx: ModuleContext) => new BookingClient(ctx),
});
