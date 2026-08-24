import { createXenitionApi } from '../src/hono';
it('404 shape on a built-in path', async () => {
  const app = createXenitionApi({ modules: ['cms'] });
  const res = await app.request('/cms/nope');
  console.log('status', res.status, 'ct', res.headers.get('content-type'), await res.text());
});
