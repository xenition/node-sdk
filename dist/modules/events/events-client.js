"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventsModule = exports.EventsClient = exports.EVENTS_MIGRATIONS = exports.EVENTS_TABLES = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.EVENTS_TABLES = {
    EVENTS: 'events__events',
    RSVPS: 'events__rsvps',
};
exports.EVENTS_MIGRATIONS = [
    {
        id: 'events/0001_create_events__events',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.EVENTS_TABLES.EVENTS} (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  capacity integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'events/0002_index_events__events_status_starts_at',
        sql: `CREATE INDEX IF NOT EXISTS events__events_status_starts_at_idx ON ${exports.EVENTS_TABLES.EVENTS} (status, starts_at)`,
    },
    {
        id: 'events/0003_create_events__rsvps',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.EVENTS_TABLES.RSVPS} (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlist', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'events/0004_index_events__rsvps_event_status',
        sql: `CREATE INDEX IF NOT EXISTS events__rsvps_event_status_idx ON ${exports.EVENTS_TABLES.RSVPS} (event_id, status)`,
    },
];
const EVENT_STATUSES = ['draft', 'published', 'cancelled'];
const RSVP_STATUSES = ['confirmed', 'waitlist', 'cancelled'];
const WHENS = ['upcoming', 'past', 'all'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_PARTY = 1;
const MAX_PARTY = 20;
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
class EventsClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    // ───────── events ─────────
    /** Create an event; slug auto-generated (and deduped) from the title. */
    async create(input) {
        const context = 'EventsClient.create';
        const title = (0, util_1.requireNonEmptyString)(context, 'title', input.title);
        const summary = (0, util_1.optionalString)(context, 'summary', input.summary, '');
        const body = (0, util_1.optionalString)(context, 'body', input.body, '');
        const data = (0, util_1.optionalPlainObject)(context, 'data', input.data, {});
        const startsAt = this.requireIso(context, 'startsAt', input.startsAt);
        const endsAt = input.endsAt === undefined ? null : this.requireIso(context, 'endsAt', input.endsAt);
        const capacity = this.validateCapacity(context, input.capacity);
        const status = this.validateStatus(context, input.status, 'published');
        const slug = input.slug !== undefined
            ? (0, util_1.requireNonEmptyString)(context, 'slug', input.slug)
            : await this.uniqueSlug((0, util_1.slugify)(title));
        const event = {
            id: (0, util_1.generateId)(),
            slug,
            title,
            summary,
            body,
            data,
            starts_at: startsAt,
            ends_at: endsAt,
            capacity,
            status,
            created_at: (0, util_1.nowIso)(),
        };
        // created_at is OWNED by the column default (now()) — omit it from the
        // wire insert. starts_at/ends_at ARE sent as ISO strings: the engine
        // binds them to the timestamptz columns natively (verified live).
        // ends_at is omitted when null so the column takes its (nullable) NULL.
        const { created_at: _omitted, ends_at, ...rest } = event;
        const row = { ...rest };
        if (ends_at !== null)
            row.ends_at = ends_at;
        await this.ctx.query.from(exports.EVENTS_TABLES.EVENTS).insert(row).execute();
        return event;
    }
    /**
     * List events by calendar slice:
     *   - `upcoming` (default): starts_at >= now, soonest first (ASC)
     *   - `past`: starts_at < now, most recent first (DESC)
     *   - `all`: no time filter, chronological (ASC)
     * Filtered to `status` (default 'published'); pass `status: 'all'` to skip.
     */
    async list(options = {}) {
        const context = 'EventsClient.list';
        const when = options.when ?? 'upcoming';
        if (!WHENS.includes(when)) {
            (0, util_1.fail)(context, `"when" must be one of ${WHENS.join(', ')} — got "${String(when)}"`);
        }
        const status = options.status ?? 'published';
        let qb = this.ctx.query.from(exports.EVENTS_TABLES.EVENTS);
        if (status !== 'all') {
            if (!EVENT_STATUSES.includes(status)) {
                (0, util_1.fail)(context, `"status" must be one of ${EVENT_STATUSES.join(', ')}, all — got "${String(status)}"`);
            }
            qb = qb.where('status', status);
        }
        const now = (0, util_1.nowIso)();
        if (when === 'upcoming')
            qb = qb.where('starts_at', '>=', now).orderBy('starts_at', 'ASC');
        else if (when === 'past')
            qb = qb.where('starts_at', '<', now).orderBy('starts_at', 'DESC');
        else
            qb = qb.orderBy('starts_at', 'ASC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    /** Fetch one event by slug, plus its live seat tallies. Null if unknown. */
    async getBySlug(slug) {
        const context = 'EventsClient.getBySlug';
        (0, util_1.requireNonEmptyString)(context, 'slug', slug);
        const event = await this.ctx.query
            .from(exports.EVENTS_TABLES.EVENTS)
            .where('slug', slug)
            .first();
        if (!event)
            return null;
        const counts = await this.counts(event.id, (0, util_1.toNumber)(event.capacity) ?? 0);
        return { ...event, ...counts };
    }
    // ───────── rsvps ─────────
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
    async rsvp(slugOrId, input) {
        const context = 'EventsClient.rsvp';
        const name = (0, util_1.requireNonEmptyString)(context, 'name', input.name);
        const email = this.requireEmail(context, input.email);
        const partySize = this.validatePartySize(context, input.partySize);
        const event = await this.resolveEvent(context, slugOrId);
        if (event.status === 'cancelled') {
            (0, util_1.fail)(context, `event "${event.slug}" is cancelled and is not accepting RSVPs`);
        }
        const capacity = (0, util_1.toNumber)(event.capacity) ?? 0;
        let status = 'confirmed';
        if (capacity > 0) {
            const confirmedSeats = await this.confirmedSeats(event.id);
            if (confirmedSeats + partySize > capacity)
                status = 'waitlist';
        }
        const rsvp = {
            id: (0, util_1.generateId)(),
            event_id: event.id,
            name,
            email,
            party_size: partySize,
            status,
            created_at: (0, util_1.nowIso)(),
        };
        // created_at owned by the DB default — omit from the wire insert.
        const { created_at: _omitted, ...row } = rsvp;
        await this.ctx.query.from(exports.EVENTS_TABLES.RSVPS).insert(row).execute();
        return rsvp;
    }
    /** RSVPs for an event, newest first; optionally filtered by status. Service key. */
    async listRsvps(eventId, options = {}) {
        const context = 'EventsClient.listRsvps';
        (0, util_1.requireNonEmptyString)(context, 'eventId', eventId);
        let qb = this.ctx.query.from(exports.EVENTS_TABLES.RSVPS).where('event_id', eventId);
        if (options.status !== undefined) {
            if (!RSVP_STATUSES.includes(options.status)) {
                (0, util_1.fail)(context, `"status" must be one of ${RSVP_STATUSES.join(', ')} — got "${String(options.status)}"`);
            }
            qb = qb.where('status', options.status);
        }
        return qb.orderBy('created_at', 'DESC').rows();
    }
    /** Cancel an RSVP by id (flips status to 'cancelled'). */
    async cancelRsvp(id) {
        const context = 'EventsClient.cancelRsvp';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        await this.ctx.query
            .from(exports.EVENTS_TABLES.RSVPS)
            .update({ status: 'cancelled' })
            .where('id', id)
            .execute();
    }
    // ───────── internals ─────────
    /**
     * Seat tallies. Capacity is measured in seats, so confirmed/waitlist are
     * SUMS of party_size (not row counts). The live engine rejects SQL
     * expressions in select columns (no `SUM(...)` — same limitation the
     * reviews aggregate hit), so we select the party_size column and sum
     * client-side.
     */
    async counts(eventId, capacity) {
        const [confirmedCount, waitlistCount] = await Promise.all([
            this.seatSum(eventId, 'confirmed'),
            this.seatSum(eventId, 'waitlist'),
        ]);
        const spotsLeft = capacity <= 0 ? null : Math.max(0, capacity - confirmedCount);
        return { confirmedCount, waitlistCount, spotsLeft };
    }
    confirmedSeats(eventId) {
        return this.seatSum(eventId, 'confirmed');
    }
    async seatSum(eventId, status) {
        const rows = await this.ctx.query
            .from(exports.EVENTS_TABLES.RSVPS)
            .where('event_id', eventId)
            .where('status', status)
            .select('party_size')
            .rows();
        // The two platform runtimes disagree on row casing (see hono/normalize.ts):
        // the gateway camelCases columns, the engine returns snake_case verbatim.
        // Read both so the seat sum is correct regardless of who served the row.
        return rows.reduce((sum, r) => sum + ((0, util_1.toNumber)(r?.party_size ?? r?.partySize) ?? 0), 0);
    }
    async resolveEvent(context, slugOrId) {
        (0, util_1.requireNonEmptyString)(context, 'slugOrId', slugOrId);
        let event = await this.ctx.query
            .from(exports.EVENTS_TABLES.EVENTS)
            .where('slug', slugOrId)
            .first();
        if (!event && UUID_RE.test(slugOrId)) {
            event = await this.ctx.query
                .from(exports.EVENTS_TABLES.EVENTS)
                .where('id', slugOrId)
                .first();
        }
        if (!event)
            (0, util_1.fail)(context, `unknown event "${slugOrId}"`);
        return event;
    }
    /**
     * Kebab slug deduped against existing rows: `mixer`, `mixer-2`, … One
     * LIKE query fetches candidates; the suffix is computed locally (mirrors
     * the cms module).
     */
    async uniqueSlug(base) {
        const rows = await this.ctx.query
            .from(exports.EVENTS_TABLES.EVENTS)
            .select('slug')
            .whereLike('slug', `${base}%`)
            .rows();
        const taken = new Set(rows.map((row) => row.slug));
        if (!taken.has(base))
            return base;
        let n = 2;
        while (taken.has(`${base}-${n}`))
            n += 1;
        return `${base}-${n}`;
    }
    requireIso(context, field, value) {
        const str = (0, util_1.requireNonEmptyString)(context, field, value);
        const ms = Date.parse(str);
        if (Number.isNaN(ms)) {
            (0, util_1.fail)(context, `"${field}" must be an ISO-8601 date string — got "${str}"`);
        }
        return str;
    }
    requireEmail(context, value) {
        const email = (0, util_1.requireNonEmptyString)(context, 'email', value);
        if (!EMAIL_RE.test(email))
            (0, util_1.fail)(context, '"email" must be a valid email address');
        return email;
    }
    validatePartySize(context, value) {
        const n = (0, util_1.optionalNumber)(context, 'partySize', value, 1);
        if (!Number.isInteger(n) || n < MIN_PARTY || n > MAX_PARTY) {
            (0, util_1.fail)(context, `"partySize" must be an integer between ${MIN_PARTY} and ${MAX_PARTY}`);
        }
        return n;
    }
    validateCapacity(context, value) {
        const n = (0, util_1.optionalNumber)(context, 'capacity', value, 0);
        if (!Number.isInteger(n) || n < 0) {
            (0, util_1.fail)(context, '"capacity" must be a non-negative integer (0 = unlimited)');
        }
        return n;
    }
    validateStatus(context, value, fallback) {
        if (value === undefined)
            return fallback;
        if (typeof value !== 'string' || !EVENT_STATUSES.includes(value)) {
            (0, util_1.fail)(context, `"status" must be one of ${EVENT_STATUSES.join(', ')} — got "${String(value)}"`);
        }
        return value;
    }
}
exports.EventsClient = EventsClient;
/** The events module definition — wire it up via `client.modules.enable('events')`. */
exports.eventsModule = (0, core_1.defineModule)({
    name: 'events',
    migrations: exports.EVENTS_MIGRATIONS,
    factory: (ctx) => new EventsClient(ctx),
});
//# sourceMappingURL=events-client.js.map