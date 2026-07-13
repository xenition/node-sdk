"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOpenApi = buildOpenApi;
exports.docsRouter = docsRouter;
const hono_1 = require("hono");
const router_utils_1 = require("./router-utils");
/* ── small builders so each route entry stays one screen tall ─────────── */
const pathParam = (name, description) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
    ...(description ? { description } : {}),
});
const queryParam = (name, description, schema = { type: 'string' }) => ({
    name,
    in: 'query',
    schema,
    ...(description ? { description } : {}),
});
const intParam = (name, description) => queryParam(name, description, { type: 'integer', minimum: 0 });
const LIST_PARAMS = [
    queryParam('orderBy', 'Column to order by (default sort)'),
    queryParam('direction', undefined, { type: 'string', enum: ['ASC', 'DESC'] }),
    intParam('limit'),
    intParam('offset'),
];
const PUBLISHED_PARAM = queryParam('published', 'Published-only by default; pass "all" to include drafts', { type: 'string', enum: ['1', 'all'] });
const jsonBody = (description, example) => ({
    required: true,
    content: { 'application/json': { schema: { type: 'object', description }, example } },
});
const okJson = (description) => ({
    description,
    content: { 'application/json': { schema: { type: 'object' } } },
});
const ERROR_REF = { $ref: '#/components/schemas/Error' };
const errorResponse = (description) => ({
    description,
    content: { 'application/json': { schema: ERROR_REF } },
});
const NOT_FOUND = errorResponse('Missing, unpublished, or intentionally indistinguishable');
const BAD_REQUEST = errorResponse('Invalid input (aggregated validation message)');
const RATE_LIMITED = errorResponse('Too many writes from this IP (default 10/min, per isolate)');
/* ── per-module route descriptions (paths relative to the API mount) ──── */
const MODULE_PATHS = {
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
};
const ALL_MODULES = Object.keys(MODULE_PATHS);
/**
 * Assemble the OpenAPI 3.0 document for the selected modules. Paths are
 * prefixed with `basePath` (default '/api', matching the conventional
 * `app.route('/api', createXenitionApi(...))` mount).
 */
function buildOpenApi(options = {}) {
    const modules = options.modules ?? ALL_MODULES;
    const basePath = options.basePath ?? '/api';
    const paths = {
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
    return {
        openapi: '3.0.3',
        info: {
            title: options.info?.title ?? 'Xenition app API',
            version: options.info?.version ?? '1.0.0',
            description: options.info?.description ??
                'Prebuilt @xenition/sdk/hono module routers running in this app’s own worker. ' +
                    'Every row is normalized to camelCase; jsonb payloads keep their inner keys. ' +
                    'Write routes are rate limited per IP (best-effort, per isolate).',
        },
        servers: [{ url: '', description: 'This origin' }],
        tags: [
            { name: 'health' },
            ...modules.map((name) => ({ name })),
        ],
        paths,
        components: {
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
/** The Swagger UI shell served at /docs — renders /openapi.json from this origin. */
const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; } .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>
`;
/**
 * A mountable docs router: GET /openapi.json (the spec) + GET /docs
 * (Swagger UI). Mount at the worker root so the docs live next to /health.
 */
function docsRouter(options = {}) {
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    const spec = buildOpenApi(options);
    app.get('/openapi.json', (c) => c.json(spec));
    app.get('/docs', (c) => c.html(DOCS_HTML));
    return app;
}
//# sourceMappingURL=docs.js.map