"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map