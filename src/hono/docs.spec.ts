import { buildOpenApi, openApiRouter } from './docs';
import type { XenitionApiModule } from './types';

type Spec = { paths: Record<string, unknown>; info: { title: string }; tags: { name: string }[] };

describe('buildOpenApi — module selection', () => {
  it('documents only the selected modules (plus /health)', () => {
    const spec = buildOpenApi({ modules: ['cms', 'forms'] }) as unknown as Spec;
    const paths = Object.keys(spec.paths);
    expect(paths).toContain('/health');
    expect(paths).toContain('/api/cms/pages/{slug}');
    expect(paths).toContain('/api/forms/{key}/submissions');
    expect(paths.some((p) => p.includes('/reviews/'))).toBe(false);
    expect(paths.some((p) => p.includes('/cart'))).toBe(false);
  });

  it('documents every module by default', () => {
    const spec = buildOpenApi() as unknown as Spec;
    const paths = Object.keys(spec.paths);
    const expected: Record<XenitionApiModule, string> = {
      cms: '/api/cms/collections/{key}/items',
      forms: '/api/forms/{key}',
      reviews: '/api/reviews/{targetType}/{targetId}',
      listings: '/api/listings',
      events: '/api/events',
      media: '/api/media/albums',
      booking: '/api/booking/resources',
      catalog: '/api/catalog/products',
      inventory: '/api/inventory/{variantId}',
      cart: '/api/cart',
      orders: '/api/orders/{id}',
      checkout: '/api/checkout/{cartToken}',
    };
    for (const path of Object.values(expected)) expect(paths).toContain(path);
  });

  it('prefixes paths with the basePath and applies info overrides', () => {
    const spec = buildOpenApi({
      modules: ['cms'],
      basePath: '/v1',
      info: { title: 'Meridian API' },
    }) as unknown as Spec;
    expect(Object.keys(spec.paths)).toContain('/v1/cms/pages/{slug}');
    expect(spec.info.title).toBe('Meridian API');
    expect(spec.tags.map((t) => t.name)).toEqual(['health', 'cms']);
  });
});

describe('openApiRouter', () => {
  it('serves the spec at /openapi.json', async () => {
    const app = openApiRouter({ modules: ['forms'], info: { title: 'T' } });
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const spec = (await res.json()) as Spec;
    expect(spec.info.title).toBe('T');
    expect(Object.keys(spec.paths)).toContain('/api/forms/{key}');
  });

  it('serves NO docs UI — OpenAPI only, by decision', async () => {
    const res = await openApiRouter().request('/docs');
    expect(res.status).toBe(404);
  });

  it('honors the shared CORS contract', async () => {
    const res = await openApiRouter({ cors: true }).request('/openapi.json', {
      headers: { Origin: 'https://app.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
