import { Hono } from 'hono';
import { applyCors } from './router-utils';
import type { XenitionApiModule } from './types';
import type { CorsOptions } from './router-utils';

/**
 * API docs for generated app backends — an OpenAPI 3.0 document assembled
 * from the SAME module list `createXenitionApi` mounts. OpenAPI only, by
 * decision: no bundled Swagger/redoc UI — consumers point their own tooling
 * at the spec. Mount `openApiRouter()` at the worker root:
 *
 *   app.route('/api', createXenitionApi({ modules: ['cms', 'forms'] }));
 *   app.route('/', openApiRouter({ modules: ['cms', 'forms'], info: { title: 'My App API' } }));
 *
 * and the worker serves the machine-readable spec at /openapi.json — zero
 * bespoke code in the template. The route descriptions below are maintained
 * ALONGSIDE the routers in this directory; when a router's surface changes,
 * update its entry here in the same commit.
 */

/** Options for `buildOpenApi` / `openApiRouter`. */
export interface DocsOptions {
  /** Which modules to document. Must match the `createXenitionApi` list. Defaults to all. */
  modules?: XenitionApiModule[];
  /**
   * The app's own routers. Their declared `paths` are merged in, so a
   * custom route is not invisible to everything that reads the spec.
   */
  custom?: Array<{ name: string; paths?: Record<string, unknown> }>;
  /** Where the API routers are mounted, prefixed onto every path. Defaults to '/api'. */
  basePath?: string;
  /** OpenAPI `info` overrides (title / version / description). */
  info?: { title?: string; version?: string; description?: string };
}

type JsonObject = Record<string, unknown>;

/* ── small builders so each route entry stays one screen tall ─────────── */

const pathParam = (name: string, description?: string): JsonObject => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  ...(description ? { description } : {}),
});

const queryParam = (name: string, description?: string, schema: JsonObject = { type: 'string' }): JsonObject => ({
  name,
  in: 'query',
  schema,
  ...(description ? { description } : {}),
});

const intParam = (name: string, description?: string): JsonObject =>
  queryParam(name, description, { type: 'integer', minimum: 0 });

const LIST_PARAMS: JsonObject[] = [
  queryParam('orderBy', 'Column to order by (default sort)'),
  queryParam('direction', undefined, { type: 'string', enum: ['ASC', 'DESC'] }),
  intParam('limit'),
  intParam('offset'),
];

const PUBLISHED_PARAM = queryParam(
  'published',
  'Published-only by default; pass "all" to include drafts',
  { type: 'string', enum: ['1', 'all'] },
);

const jsonBody = (description: string, example: JsonObject): JsonObject => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', description }, example } },
});

const okJson = (description: string): JsonObject => ({
  description,
  content: { 'application/json': { schema: { type: 'object' } } },
});

const ERROR_REF = { $ref: '#/components/schemas/Error' };
const errorResponse = (description: string): JsonObject => ({
  description,
  content: { 'application/json': { schema: ERROR_REF } },
});
const NOT_FOUND = errorResponse('Missing, unpublished, or intentionally indistinguishable');
const BAD_REQUEST = errorResponse('Invalid input (aggregated validation message)');
const RATE_LIMITED = errorResponse('Too many writes from this IP (default 10/min, per isolate)');
const UNAUTHORIZED = errorResponse('Missing, invalid, or expired end-user access token');
const NOT_CONFIGURED = errorResponse('This app never configured that store platform');

/* ── per-module route descriptions (paths relative to the API mount) ──── */

const MODULE_PATHS: Record<XenitionApiModule, Record<string, JsonObject>> = {
  auth: {
    '/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Create an account and return a session',
        description:
          'Fields are copied by name — email, password, name?, metadata? — and anything else ' +
          'in the body is dropped rather than forwarded to a service-key call. Rate limited ' +
          'harder than the write default (5/min per IP).',
        requestBody: jsonBody('Registration', {
          email: 'ada@example.com',
          password: 'correct horse battery staple',
        }),
        responses: {
          '201': okJson('{ user, session, token, refreshToken, expiresAt }'),
          '400': BAD_REQUEST,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Sign in with email and password',
        requestBody: jsonBody('Credentials', { email: 'ada@example.com', password: '…' }),
        responses: {
          '200': okJson('{ user, session, token, refreshToken, expiresAt }'),
          '400': BAD_REQUEST,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['auth'],
        summary: 'Exchange a refresh token for a fresh session',
        description:
          'Public: the access token has just expired, which is why the caller is here — the ' +
          'refresh token IS the credential. Store what comes BACK; a platform that rotates ' +
          'refresh tokens invalidates the one you sent. Answers 404 naming the endpoint on a ' +
          'deployment whose gateway has not shipped it yet.',
        requestBody: jsonBody('The stored refresh token', { refreshToken: '…' }),
        responses: {
          '200': okJson('{ user, session, token, refreshToken, expiresAt }'),
          '400': BAD_REQUEST,
          '404': errorResponse('This deployment does not implement /app-platform/auth/refresh'),
        },
      },
    },
    '/auth/otp/send': {
      post: {
        tags: ['auth'],
        summary: 'Send a one-time code by email or SMS',
        description:
          'One of `email` / `phone` is required. The response never says whether the address ' +
          'was known — that would make this an account-enumeration oracle. 5/min per IP.',
        requestBody: jsonBody('{ email? , phone?, purpose? }', {
          email: 'ada@example.com',
          purpose: 'signin',
        }),
        responses: {
          '200': okJson('{ sent: true, channel, expiresAt, retryAfterSeconds? }'),
          '400': BAD_REQUEST,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/otp/verify': {
      post: {
        tags: ['auth'],
        summary: 'Redeem a one-time code',
        description:
          "`purpose: 'signin'` returns a full session. Rate limited at 5/min per IP: a " +
          'six-digit code is the most brute-forceable thing on this router.',
        requestBody: jsonBody('{ code, email? , phone?, purpose? }', {
          email: 'ada@example.com',
          code: '123456',
        }),
        responses: {
          '200': okJson('{ user, session, token, refreshToken, expiresAt }'),
          '400': BAD_REQUEST,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/password-reset/request': {
      post: {
        tags: ['auth'],
        summary: 'Send the password-reset email',
        description: 'Answers `{ requested: true }` whether or not the address exists.',
        requestBody: jsonBody('{ email, redirectUrl }', {
          email: 'ada@example.com',
          redirectUrl: 'https://app.example.com/reset',
        }),
        responses: { '200': okJson('{ requested: true }'), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
    '/auth/password-reset/confirm': {
      post: {
        tags: ['auth'],
        summary: 'Set a new password with the emailed token',
        requestBody: jsonBody('{ token, newPassword }', { token: '…', newPassword: '…' }),
        responses: { '200': okJson('{ reset: true }'), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
    '/auth/email/verify': {
      post: {
        tags: ['auth'],
        summary: 'Verify an email address with its token',
        requestBody: jsonBody('{ token }', { token: '…' }),
        responses: { '200': okJson('{ verified: true }'), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
    '/auth/oauth/providers': {
      get: {
        tags: ['auth'],
        summary: 'Which sign-in buttons to render',
        description:
          'Read-only and public — a login screen is drawn before anyone signs in. Render only ' +
          'providers whose `isAvailable` is true. Configuring a provider is a service-key ' +
          'operation and has no route here.',
        responses: { '200': okJson('{ providers: [{ provider, isAvailable, … }] }') },
      },
    },
    '/auth/oauth/{provider}/url': {
      get: {
        tags: ['auth'],
        summary: 'Start the browser redirect flow',
        description: 'Mobile uses `/auth/oauth/{provider}/id-token` instead.',
        parameters: [
          pathParam('provider', 'google | github | facebook | twitter | apple'),
          queryParam('redirectUrl', 'Where the provider sends the user back'),
        ],
        responses: { '200': okJson('{ url, state }'), '400': BAD_REQUEST },
      },
    },
    '/auth/oauth/{provider}/callback': {
      post: {
        tags: ['auth'],
        summary: 'Finish the browser redirect flow',
        parameters: [pathParam('provider')],
        requestBody: jsonBody('{ code, state }', { code: '…', state: '…' }),
        responses: {
          '200': okJson('{ user, session, token, refreshToken, expiresAt }'),
          '400': BAD_REQUEST,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/oauth/{provider}/id-token': {
      post: {
        tags: ['auth'],
        summary: 'Native sign-in with a device-obtained id token',
        description:
          'What a phone actually does: the platform SDK completes sign-in locally and the ' +
          "server verifies the token against the provider's published keys. Pass the `nonce` " +
          'the app generated — Apple echoes it inside the token, which is what stops a token ' +
          'captured from another session being replayed.',
        parameters: [pathParam('provider')],
        requestBody: jsonBody('{ idToken, nonce?, name? }', { idToken: '…', nonce: '…' }),
        responses: {
          '200': okJson('{ user, session, token, refreshToken, expiresAt }'),
          '400': BAD_REQUEST,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'The signed-in caller',
        description:
          'Always the bearer of the token — there is no user id parameter, and a body field ' +
          'here would let anyone read anyone. Answered from the identity `requireAuth()` just ' +
          "resolved, so it is as fresh as that middleware's token cache (default 60s).",
        security: [{ bearerAuth: [] }],
        responses: { '200': okJson('The user, camelCased'), '401': UNAUTHORIZED },
      },
    },
    '/auth/profile': {
      patch: {
        tags: ['auth'],
        summary: "Update the caller's own profile",
        description:
          'Only `name`, `phone` and `metadata` are read; every other field is dropped. Returns ' +
          'the updated record, so an app never has to re-read /auth/me after a change.',
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody('{ name?, phone?, metadata? }', { name: 'Ada Lovelace' }),
        responses: {
          '200': okJson('The updated user, camelCased'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/password': {
      post: {
        tags: ['auth'],
        summary: 'Change the password while signed in',
        description:
          'Proves identity with the CURRENT password rather than an emailed token, so someone ' +
          'holding an unlocked phone cannot silently lock the owner out. 5/min per IP.',
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody('{ currentPassword, newPassword }', {
          currentPassword: '…',
          newPassword: '…',
        }),
        responses: {
          '200': okJson('{ changed: true }'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'End the current session',
        description:
          "Reads no body. `requireAuth()`'s token cache is isolate-local with no eviction " +
          'hook, so the token can still authenticate for up to `cacheTtlSeconds` (default 60) ' +
          'afterwards — mount the middleware with `cacheTtlSeconds: 0` if that matters.',
        security: [{ bearerAuth: [] }],
        responses: { '200': okJson('{ ok: true }'), '401': UNAUTHORIZED, '429': RATE_LIMITED },
      },
    },
    '/auth/sessions': {
      get: {
        tags: ['auth'],
        summary: 'The "signed in on these devices" list',
        security: [{ bearerAuth: [] }],
        responses: { '200': okJson('{ sessions: [...] }'), '401': UNAUTHORIZED },
      },
      delete: {
        tags: ['auth'],
        summary: 'Sign every device out, this one included',
        description: 'The button someone reaches for after losing a phone.',
        security: [{ bearerAuth: [] }],
        responses: { '200': okJson('{ revoked: <count> }'), '401': UNAUTHORIZED, '429': RATE_LIMITED },
      },
    },
    '/auth/sessions/{sessionId}': {
      delete: {
        tags: ['auth'],
        summary: 'Sign one other device out',
        description:
          "Scoped by the caller's own token: the id is never resolved against anyone else's " +
          'sessions.',
        security: [{ bearerAuth: [] }],
        parameters: [pathParam('sessionId')],
        responses: { '200': okJson('{ revoked: true }'), '401': UNAUTHORIZED, '429': RATE_LIMITED },
      },
    },
    '/auth/account': {
      delete: {
        tags: ['auth'],
        summary: "Delete the caller's own account",
        description:
          'Apple has required in-app account deletion since June 2022 and rejects at review ' +
          'without it. Mounted before the gateway implements it, so an app has the route the ' +
          'day it ships; until then it answers 404 naming the missing endpoint.',
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody('{ password?, reason? }', {}),
        responses: {
          '200': okJson('{ deleted: true, purgeAt? }'),
          '401': UNAUTHORIZED,
          '404': errorResponse('This deployment does not implement /app-platform/auth/account'),
          '429': RATE_LIMITED,
        },
      },
    },
    '/auth/account/export': {
      get: {
        tags: ['auth'],
        summary: 'Everything the platform holds about the caller',
        description:
          'The other half of the same obligation as deletion: a user must be able to leave ' +
          'WITH their data, not merely to leave.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': okJson('{ user, sessions?, data?, generatedAt }'),
          '401': UNAUTHORIZED,
          '404': errorResponse(
            'This deployment does not implement /app-platform/auth/account/export',
          ),
        },
      },
    },
  },

  cms: {
    '/cms/pages/{slug}': {
      get: {
        tags: ['cms'],
        summary: 'Get a published page by slug',
        parameters: [pathParam('slug')],
        responses: { '200': okJson('The page, camelCased'), '404': NOT_FOUND },
      },
    },
    '/cms/collections/{key}/items': {
      get: {
        tags: ['cms'],
        summary: 'List items in a collection',
        parameters: [pathParam('key'), PUBLISHED_PARAM, ...LIST_PARAMS],
        responses: { '200': okJson('{ items: [...] } (rows camelCased)'), '400': BAD_REQUEST },
      },
    },
    '/cms/collections/{key}/items/{slug}': {
      get: {
        tags: ['cms'],
        summary: 'Get one published item by slug',
        parameters: [pathParam('key'), pathParam('slug')],
        responses: { '200': okJson('The item, camelCased'), '404': NOT_FOUND },
      },
    },
  },

  forms: {
    '/forms/{key}': {
      get: {
        tags: ['forms'],
        summary: "Get a form's field schema (for rendering)",
        parameters: [pathParam('key')],
        responses: { '200': okJson('{ key, title, fields: [{name, type, required?, …}] }'), '404': NOT_FOUND },
      },
    },
    '/forms/{key}/submissions': {
      post: {
        tags: ['forms'],
        summary: 'Submit a form (schema-validated, rate limited)',
        parameters: [pathParam('key')],
        requestBody: jsonBody('The submission data object (field name → value)', {
          email: 'ada@example.com',
        }),
        responses: {
          '201': okJson('{ id }'),
          '400': BAD_REQUEST,
          '404': NOT_FOUND,
          '429': RATE_LIMITED,
        },
      },
    },
  },

  reviews: {
    '/reviews/{targetType}/{targetId}': {
      get: {
        tags: ['reviews'],
        summary: 'Approved reviews + aggregate for a target, in one payload',
        parameters: [pathParam('targetType'), pathParam('targetId'), intParam('limit'), intParam('offset')],
        responses: { '200': okJson('{ reviews: [...approved], aggregate: {count, average} }'), '400': BAD_REQUEST },
      },
      post: {
        tags: ['reviews'],
        summary: 'Submit a review (always lands pending; rate limited)',
        parameters: [pathParam('targetType'), pathParam('targetId')],
        requestBody: jsonBody('Review input', { authorName: 'Ada', rating: 5, title: 'Great', body: '…' }),
        responses: { '201': okJson("{ id, status: 'pending' }"), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
  },

  listings: {
    '/listings': {
      get: {
        tags: ['listings'],
        summary: 'List published listings in a category',
        parameters: [
          queryParam('category', 'Required — the listing category to read'),
          queryParam('status'),
          queryParam('featured', undefined, { type: 'string', enum: ['1', '0', 'true', 'false'] }),
          ...LIST_PARAMS,
        ],
        responses: { '200': okJson('{ listings: [...] }'), '400': BAD_REQUEST },
      },
      post: {
        tags: ['listings'],
        summary: 'Submit a listing (always lands pending; rate limited)',
        requestBody: jsonBody('Listing input', { category: 'jobs', title: 'Senior baker', summary: '…' }),
        responses: { '201': okJson("{ id, slug, status: 'pending' }"), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
    '/listings/meta/categories': {
      get: {
        tags: ['listings'],
        summary: 'Distinct categories with published listings',
        responses: { '200': okJson('{ categories: [...] }') },
      },
    },
    '/listings/{slug}': {
      get: {
        tags: ['listings'],
        summary: 'Get a single published listing',
        parameters: [pathParam('slug')],
        responses: { '200': okJson('The listing, camelCased'), '404': NOT_FOUND },
      },
    },
  },

  events: {
    '/events': {
      get: {
        tags: ['events'],
        summary: 'List events',
        parameters: [
          queryParam('when', undefined, { type: 'string', enum: ['upcoming', 'past', 'all'] }),
          queryParam('status'),
          intParam('limit'),
          intParam('offset'),
        ],
        responses: { '200': okJson('{ events: [...] }'), '400': BAD_REQUEST },
      },
    },
    '/events/{slug}': {
      get: {
        tags: ['events'],
        summary: 'Get an event with capacity counts',
        parameters: [pathParam('slug')],
        responses: {
          '200': okJson('The event + { confirmedCount, waitlistCount, spotsLeft }'),
          '404': NOT_FOUND,
        },
      },
    },
    '/events/{slug}/rsvps': {
      post: {
        tags: ['events'],
        summary: 'RSVP to an event (rate limited)',
        parameters: [pathParam('slug')],
        requestBody: jsonBody('RSVP input', { name: 'Ada', email: 'ada@example.com', partySize: 2 }),
        responses: { '201': okJson("{ id, status: 'confirmed' | 'waitlist' }"), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
    '/events/rsvps/{id}': {
      get: {
        tags: ['events'],
        summary: 'RSVP by unguessable id (the confirmation-page access token)',
        parameters: [pathParam('id')],
        responses: { '200': okJson('The RSVP, camelCased'), '404': NOT_FOUND },
      },
    },
  },

  media: {
    '/media/albums': {
      get: {
        tags: ['media'],
        summary: 'List published albums',
        parameters: [PUBLISHED_PARAM, ...LIST_PARAMS],
        responses: { '200': okJson('{ albums: [...] }'), '400': BAD_REQUEST },
      },
    },
    '/media/albums/{slug}': {
      get: {
        tags: ['media'],
        summary: 'Get an album with its items (the gallery-render payload)',
        parameters: [pathParam('slug')],
        responses: { '200': okJson('The album + { items: [...] }'), '404': NOT_FOUND },
      },
    },
    '/media/albums/{slug}/items': {
      get: {
        tags: ['media'],
        summary: "List an album's items",
        parameters: [pathParam('slug')],
        responses: { '200': okJson('{ items: [...] }'), '404': NOT_FOUND },
      },
    },
  },

  booking: {
    '/booking/resources': {
      get: {
        tags: ['booking'],
        summary: 'List bookable resources',
        parameters: [queryParam('status')],
        responses: { '200': okJson('{ resources: [...] }') },
      },
    },
    '/booking/resources/{slug}': {
      get: {
        tags: ['booking'],
        summary: 'Get a resource',
        parameters: [pathParam('slug')],
        responses: { '200': okJson('The resource, camelCased'), '404': NOT_FOUND },
      },
    },
    '/booking/resources/{slug}/slots': {
      get: {
        tags: ['booking'],
        summary: 'Public availability between two instants',
        parameters: [
          pathParam('slug'),
          queryParam('from', 'Required ISO-8601 range start'),
          queryParam('to', 'Required ISO-8601 range end'),
        ],
        responses: { '200': okJson('{ slots: [{startsAt, endsAt, spotsLeft}] }'), '400': BAD_REQUEST },
      },
    },
    '/booking/resources/{slug}/bookings': {
      post: {
        tags: ['booking'],
        summary: 'Book a slot (rate limited; 409 when the slot is gone)',
        parameters: [pathParam('slug')],
        requestBody: jsonBody('Booking input', {
          startsAt: '2026-08-01T10:00:00Z',
          customerName: 'Ada',
          customerEmail: 'ada@example.com',
        }),
        responses: {
          '201': okJson("{ id, startsAt, status: 'confirmed' }"),
          '400': BAD_REQUEST,
          '409': errorResponse('SLOT_UNAVAILABLE — the slot was taken, closed, or at capacity'),
          '429': RATE_LIMITED,
        },
      },
    },
    '/booking/bookings/{id}': {
      get: {
        tags: ['booking'],
        summary: 'Booking by unguessable id (the confirmation-page access token)',
        parameters: [pathParam('id')],
        responses: { '200': okJson('The booking, camelCased'), '404': NOT_FOUND },
      },
    },
  },

  catalog: {
    '/catalog/products': {
      get: {
        tags: ['catalog'],
        summary: 'List published products (no variants; money in integer cents)',
        parameters: [queryParam('collection'), queryParam('status'), ...LIST_PARAMS],
        responses: { '200': okJson('{ products: [...] }'), '400': BAD_REQUEST },
      },
    },
    '/catalog/products/{slug}': {
      get: {
        tags: ['catalog'],
        summary: 'Get a published product with its variants',
        parameters: [pathParam('slug')],
        responses: { '200': okJson('The product + { variants: [...] }'), '404': NOT_FOUND },
      },
    },
    '/catalog/collections': {
      get: {
        tags: ['catalog'],
        summary: 'List collections',
        responses: { '200': okJson('{ collections: [...] }') },
      },
    },
    '/catalog/collections/{slug}/products': {
      get: {
        tags: ['catalog'],
        summary: "List a collection's products",
        parameters: [pathParam('slug'), queryParam('status'), ...LIST_PARAMS],
        responses: { '200': okJson('{ collection, products: [...] }'), '404': NOT_FOUND },
      },
    },
  },

  inventory: {
    '/inventory/{variantId}': {
      get: {
        tags: ['inventory'],
        summary: "A variant's derived availability (never 404s — no stock row reads as zero)",
        parameters: [pathParam('variantId')],
        responses: { '200': okJson('{ variantId, quantity, reserved, available, policy }') },
      },
    },
  },

  cart: {
    '/cart': {
      post: {
        tags: ['cart'],
        summary: 'Mint a cart (opaque token is the only capability; rate limited)',
        responses: { '201': okJson('{ token }'), '429': RATE_LIMITED },
      },
    },
    '/cart/{token}': {
      get: {
        tags: ['cart'],
        summary: 'The cart view (money in integer cents)',
        parameters: [pathParam('token')],
        responses: { '200': okJson('{ token, currency, items, subtotalCents }') },
      },
    },
    '/cart/{token}/items': {
      post: {
        tags: ['cart'],
        summary: 'Add an item (rate limited)',
        parameters: [pathParam('token')],
        requestBody: jsonBody('Line input', { variantId: 'var_1', quantity: 1 }),
        responses: { '200': okJson('The updated cart view'), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
    '/cart/{token}/items/{itemId}': {
      patch: {
        tags: ['cart'],
        summary: "Change a line's quantity (rate limited)",
        parameters: [pathParam('token'), pathParam('itemId')],
        requestBody: jsonBody('Quantity input', { quantity: 2 }),
        responses: { '200': okJson('The updated cart view'), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
      delete: {
        tags: ['cart'],
        summary: 'Remove a line (rate limited)',
        parameters: [pathParam('token'), pathParam('itemId')],
        responses: { '200': okJson('The updated cart view'), '429': RATE_LIMITED },
      },
    },
  },

  orders: {
    '/orders/by-number/{number}': {
      get: {
        tags: ['orders'],
        summary: 'Email-gated order lookup by human-typable number',
        parameters: [
          pathParam('number'),
          queryParam('email', "Must match the order's email (case-insensitive); mismatch and unknown both 404"),
        ],
        responses: { '200': okJson('The order + { items: [...] }'), '404': NOT_FOUND },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['orders'],
        summary: 'Order by unguessable id (the confirmation-page access token)',
        parameters: [pathParam('id')],
        responses: { '200': okJson('The order + { items: [...] }'), '404': NOT_FOUND },
      },
    },
  },

  checkout: {
    '/checkout/{cartToken}': {
      post: {
        tags: ['checkout'],
        summary: 'Create a pending order from a cart and get a pay URL (mock or Stripe)',
        parameters: [pathParam('cartToken')],
        requestBody: jsonBody('Checkout input', { email: 'ada@example.com' }),
        responses: { '200': okJson("{ orderId, mode: 'mock' | 'stripe', payUrl }"), '400': BAD_REQUEST, '429': RATE_LIMITED },
      },
    },
    '/checkout/mock/complete': {
      post: {
        tags: ['checkout'],
        summary: 'Mock mode only — simulate the payment webhook (403 in stripe mode)',
        requestBody: jsonBody('Order reference', { orderId: 'ord_1' }),
        responses: { '200': okJson('The paid order'), '400': BAD_REQUEST, '403': errorResponse('Stripe mode') },
      },
    },
    '/checkout/webhook': {
      post: {
        tags: ['checkout'],
        summary: 'Stripe webhook (signature-verified, idempotent)',
        responses: { '200': okJson('{ received: true }'), '400': errorResponse('Invalid signature or body') },
      },
    },
    '/checkout/order/{id}': {
      get: {
        tags: ['checkout'],
        summary: 'The order + items (confirmation read)',
        parameters: [pathParam('id')],
        responses: { '200': okJson('The order + { items: [...] }'), '404': NOT_FOUND },
      },
    },
  },
  jobs: {
    '/jobs/{id}': {
      get: {
        tags: ['jobs'],
        summary: 'Status of a background job',
        description:
          'Visible only when the job payload names the caller (default field `userId`). ' +
          'Unknown and not-yours are the same 404 — distinguishing them would confirm ' +
          'which ids exist. Poll until `done`.',
        security: [{ bearerAuth: [] }],
        parameters: [pathParam('id')],
        responses: {
          '200': okJson('{ id, type, status, attempts, done, failed, result }'),
          '401': UNAUTHORIZED,
          '404': NOT_FOUND,
        },
      },
    },
  },
  billing: {
    '/billing/products': {
      get: {
        tags: ['billing'],
        summary: 'Sellable products, for building the paywall',
        parameters: [
          {
            name: 'platform',
            in: 'query',
            schema: { type: 'string', enum: ['apple', 'google', 'stripe'] },
          },
        ],
        responses: { '200': okJson('{ products: [...] }'), '400': BAD_REQUEST },
      },
    },
    '/billing/entitlements': {
      get: {
        tags: ['billing'],
        summary: 'Every entitlement for the authenticated caller',
        security: [{ bearerAuth: [] }],
        responses: { '200': okJson('{ entitlements: [EntitlementCheck] }'), '401': UNAUTHORIZED },
      },
    },
    '/billing/entitlements/{key}': {
      get: {
        tags: ['billing'],
        summary: 'May the caller use this feature?',
        security: [{ bearerAuth: [] }],
        parameters: [pathParam('key', 'Entitlement name, e.g. "premium"')],
        responses: {
          '200': okJson('EntitlementCheck: { allowed, source, expiresAt, daysRemaining, isTrial }'),
          '401': UNAUTHORIZED,
        },
      },
    },
    '/billing/verify': {
      post: {
        tags: ['billing'],
        summary: 'Verify a store purchase and grant its entitlement',
        description:
          'apple: { platform: "apple", transactionId }. ' +
          'google: { platform: "google", productId, purchaseToken, kind? }. ' +
          'The purchase is bound to the authenticated caller — never to a user id in the body.',
        security: [{ bearerAuth: [] }],
        responses: {
          '201': okJson('{ ok, entitlement, product, acknowledged? }'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '429': RATE_LIMITED,
          '501': NOT_CONFIGURED,
        },
      },
    },
    '/billing/restore': {
      post: {
        tags: ['billing'],
        summary: 'Re-apply purchases after a reinstall or device change',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': okJson('{ entitlements: [EntitlementCheck] }'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '501': NOT_CONFIGURED,
        },
      },
    },
    '/billing/trial': {
      post: {
        tags: ['billing'],
        summary: 'Start the free trial (length is server-side)',
        description:
          'Idempotent: a second call returns the current entitlement rather than an error. ' +
          '501 when BILLING_TRIAL_DAYS / trialDays is not set.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': okJson('The existing EntitlementCheck'),
          '201': okJson('The new trial EntitlementCheck'),
          '401': UNAUTHORIZED,
          '501': NOT_CONFIGURED,
        },
      },
    },
    '/billing/webhooks/apple': {
      post: {
        tags: ['billing'],
        summary: 'App Store Server Notification (v2) endpoint',
        description:
          'Unauthenticated by necessity — Apple cannot present a user token. Safe because the ' +
          'notification only triggers a re-read of state from Apple; it is never trusted as ' +
          'state itself. Idempotent on notificationUUID.',
        responses: { '200': okJson('{ received, handled, type }'), '400': BAD_REQUEST },
      },
    },
    '/billing/webhooks/google': {
      post: {
        tags: ['billing'],
        summary: 'Play Real-time Developer Notification (Pub/Sub push) endpoint',
        description: 'Same contract as the Apple webhook. Idempotent on the Pub/Sub messageId.',
        responses: { '200': okJson('{ received, handled, type }'), '400': BAD_REQUEST },
      },
    },
  },
  notifications: {
    '/notifications': {
      get: {
        tags: ['notifications'],
        summary: "The caller's inbox, newest first",
        description:
          'Keyset-paginated: pass the returned `nextCursor` back as `before`. An offset would ' +
          'skip and duplicate rows in a feed that is written to while it is read. Always the ' +
          "authenticated caller's inbox — there is no user id parameter.",
        security: [{ bearerAuth: [] }],
        parameters: [
          queryParam('unread', 'Unread only', { type: 'string', enum: ['1', '0', 'true', 'false'] }),
          queryParam('category', 'One category, e.g. "billing"'),
          intParam('limit', 'Default 25, capped at 100'),
          queryParam('before', 'Cursor — the createdAt of the last row you saw'),
        ],
        responses: {
          '200': okJson('{ notifications: [...], nextCursor }'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
        },
      },
    },
    '/notifications/unread-count': {
      get: {
        tags: ['notifications'],
        summary: 'Badge count for the caller',
        security: [{ bearerAuth: [] }],
        responses: { '200': okJson('{ count }'), '401': UNAUTHORIZED },
      },
    },
    '/notifications/read-all': {
      post: {
        tags: ['notifications'],
        summary: 'Mark every unread notification read',
        description: 'Returns the resulting badge count, so the app need not ask again.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': okJson('{ read: true, unreadCount }'),
          '401': UNAUTHORIZED,
          '429': RATE_LIMITED,
        },
      },
    },
    '/notifications/{id}/read': {
      post: {
        tags: ['notifications'],
        summary: 'Mark one notification read',
        description:
          'Idempotent, and scoped to the caller: an id belonging to someone else updates ' +
          'nothing and reports the same success, which tells the caller nothing about which ' +
          'ids exist.',
        security: [{ bearerAuth: [] }],
        parameters: [pathParam('id')],
        responses: { '200': okJson('{ read: true }'), '401': UNAUTHORIZED, '429': RATE_LIMITED },
      },
    },
    '/notifications/preferences': {
      get: {
        tags: ['notifications'],
        summary: 'Per-category channels and quiet hours',
        description:
          'A category the user has never touched comes back with the module defaults ' +
          '(in-app and push on, email off) rather than being missing, so a settings screen ' +
          'renders on a fresh account.',
        security: [{ bearerAuth: [] }],
        responses: { '200': okJson('{ preferences: [...] }'), '401': UNAUTHORIZED },
      },
      put: {
        tags: ['notifications'],
        summary: 'Update channels and quiet hours',
        description:
          'camelCase throughout: { category?, inApp?, push?, email?, quietStartMinute?, ' +
          'quietEndMinute?, utcOffsetMinutes? }. Quiet minutes are 0–1439 past local ' +
          'midnight; null clears the window and an omitted field leaves it alone. An omitted ' +
          'category writes to every configured category — one quiet-hours control means ' +
          'quiet everywhere.',
        requestBody: jsonBody('Preference patch', {
          push: false,
          quietStartMinute: 1320,
          quietEndMinute: 420,
          utcOffsetMinutes: 60,
        }),
        security: [{ bearerAuth: [] }],
        responses: {
          '200': okJson('{ preferences: [...] }'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '429': RATE_LIMITED,
        },
      },
    },
  },
  quotas: {
    '/quotas': {
      get: {
        tags: ['quotas'],
        summary: 'Peek several quotas at once',
        description:
          'Comma-separated `keys`, or every quota this app meters when omitted. Reading ' +
          'never consumes. Limits and periods are server-side configuration — a ' +
          'client-supplied limit would let anyone grant themselves an unlimited allowance.',
        security: [{ bearerAuth: [] }],
        parameters: [queryParam('keys', 'Comma-separated quota keys, e.g. "analysis,export"')],
        responses: {
          '200': okJson('{ quotas: [{ key, allowed, used, limit, remaining, period, resetAt }] }'),
          '400': BAD_REQUEST,
          '401': UNAUTHORIZED,
          '501': NOT_CONFIGURED,
        },
      },
    },
    '/quotas/{key}': {
      get: {
        tags: ['quotas'],
        summary: 'Peek one quota — "2 of 5 used"',
        description: 'A read never spends a run; consuming stays server-side, in the route ' +
          'that does the expensive work.',
        security: [{ bearerAuth: [] }],
        parameters: [pathParam('key', 'Quota key, e.g. "analysis"')],
        responses: {
          '200': okJson('{ key, allowed, used, limit, remaining, period, resetAt }'),
          '401': UNAUTHORIZED,
          '404': errorResponse('This app meters no such quota'),
          '501': NOT_CONFIGURED,
        },
      },
    },
  },
};

const ALL_MODULES = Object.keys(MODULE_PATHS) as XenitionApiModule[];

/**
 * Assemble the OpenAPI 3.0 document for the selected modules. Paths are
 * prefixed with `basePath` (default '/api', matching the conventional
 * `app.route('/api', createXenitionApi(...))` mount).
 */
export function buildOpenApi(options: DocsOptions = {}): JsonObject {
  const modules = options.modules ?? ALL_MODULES;
  const basePath = options.basePath ?? '/api';
  const paths: Record<string, JsonObject> = {
    '/health': {
      get: {
        tags: ['health'],
        summary: 'Liveness check',
        responses: { '200': okJson('{ ok: true, app }') },
      },
    },
  };
  for (const moduleName of modules) {
    for (const [path, item] of Object.entries(MODULE_PATHS[moduleName] ?? {})) {
      paths[`${basePath}${path}`] = item;
    }
  }
  for (const router of options.custom ?? []) {
    for (const [path, item] of Object.entries(router.paths ?? {})) {
      paths[`${basePath}${path}`] = item as JsonObject;
    }
  }
  return {
    openapi: '3.0.3',
    info: {
      title: options.info?.title ?? 'Xenition app API',
      version: options.info?.version ?? '1.0.0',
      description:
        options.info?.description ??
        'Prebuilt @xenition/sdk/hono module routers running in this app’s own worker. ' +
          'Every row is normalized to camelCase; jsonb payloads keep their inner keys. ' +
          'Write routes are rate limited per IP (best-effort, per isolate).',
    },
    servers: [{ url: '', description: 'This origin' }],
    tags: [
      { name: 'health' },
      ...modules.map((name) => ({ name })),
      ...(options.custom ?? []).map((router) => ({ name: router.name })),
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: "The end user's access token from auth.login().",
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
  };
}

/** CORS is the only router option that matters for a GET-only spec route. */
export interface OpenApiRouterOptions extends DocsOptions {
  /**
   * Same contract as every other router — see `XenitionRouterOptions.cors`.
   * Spelled with the shared type rather than a narrower copy, because a
   * second declaration of the same option is a second thing to forget when
   * the first one grows.
   */
  cors?: boolean | string[] | CorsOptions;
}

/**
 * A mountable spec router: GET /openapi.json — the OpenAPI document for the
 * mounted modules. Mount at the worker root so it lives next to /health.
 * OpenAPI only (no bundled docs UI) by decision.
 */
export function openApiRouter(options: OpenApiRouterOptions = {}): Hono {
  const app = new Hono();
  applyCors(app, options.cors);
  const spec = buildOpenApi(options);
  app.get('/openapi.json', (c) => c.json(spec));
  return app;
}
