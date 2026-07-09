"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map