"use strict";
/**
 * listings module types — a directory / classified / real-estate /
 * job-board core over a single `listings__listings` table.
 *
 * A listing is a slugged, categorized content record whose domain-specific
 * fields (location, price-as-text, contact, image urls, tags, …) live in an
 * arbitrary `data` jsonb payload, so one table serves cars, rentals, jobs,
 * … without per-domain schemas. There are NO payments here — this is the
 * content primitive, not a marketplace checkout.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map