/**
 * `@xenition/sdk/client` — the browser/worker data layer for generated apps.
 *
 * A framework-agnostic, key-less client for a template's OWN backend (which
 * mounts the `@xenition/sdk/hono` routers). Zero node builtins, zero axios,
 * global `fetch` only — safe to bundle into any frontend. Unlike `./hono`
 * (node-only), this subpath IS browser-safe and ships in both builds.
 *
 * The exported TYPES are the single source of truth for the API shapes
 * templates consume — they mirror the router normalization (camelCase) so a
 * template's data layer collapses to imports from this one module.
 */
export { createAppClient } from './app-client';
export { AppClientError } from './errors';
export { formatDate } from './format';
export type { AppClient, CmsClient, ListingsClient, EventsClient, FormsClient, ReviewsClient, CmsPage, CmsItem, CmsItemsOptions, Listing, ListingStatus, ListingsListOptions, ListingSubmitInput, ListingSubmitResult, EventStatus, EventWhen, EventSummary, EventDetail, EventsListOptions, RsvpInput, RsvpResult, FormFieldType, FormField, FormSchema, FormSubmitResult, ReviewStatus, Review, ReviewAggregate, ReviewsResult, ReviewSubmitInput, ReviewSubmitResult, } from './types';
//# sourceMappingURL=index.d.ts.map