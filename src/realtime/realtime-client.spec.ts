import { RealtimeClient } from './realtime-client';
import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';

// Never open a real socket from unit tests.
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

/** Build a client around a stub HttpClient exposing just what it uses. */
const makeClient = (baseUrl: string, post = jest.fn()) =>
  new RealtimeClient(
    { baseUrl, post } as unknown as HttpClient,
    'xen_service_test',
  );

/** deriveWsUrl is private; index access sidesteps visibility for testing. */
const derive = (baseUrl: string): string =>
  makeClient(baseUrl)['deriveWsUrl']();

describe('deriveWsUrl', () => {
  it('strips the /v1 suffix of the default base URL', () => {
    expect(derive('https://api-dev.xenition.com/v1')).toBe(
      'https://api-dev.xenition.com',
    );
    expect(derive('https://api.xenition.com/v1')).toBe(
      'https://api.xenition.com',
    );
  });

  it('strips a legacy /api/v1 suffix', () => {
    expect(derive('https://legacy.example.com/api/v1')).toBe(
      'https://legacy.example.com',
    );
  });

  it('tolerates trailing slashes', () => {
    expect(derive('https://api-dev.xenition.com/v1/')).toBe(
      'https://api-dev.xenition.com',
    );
    expect(derive('https://legacy.example.com/api/v1/')).toBe(
      'https://legacy.example.com',
    );
    expect(derive('https://plain.example.com/')).toBe(
      'https://plain.example.com',
    );
  });

  it('returns the origin untouched when there is no version suffix', () => {
    expect(derive('https://custom.example.com')).toBe('https://custom.example.com');
  });

  it('preserves a custom mount path in front of the version suffix', () => {
    expect(derive('https://custom.example.com/gateway/v1')).toBe(
      'https://custom.example.com/gateway',
    );
  });

  it('keeps ports and only strips a suffix match', () => {
    expect(derive('http://localhost:8787/v1')).toBe('http://localhost:8787');
    // /v1 in the middle is not a suffix — untouched.
    expect(derive('https://x.example.com/v1/tenant')).toBe(
      'https://x.example.com/v1/tenant',
    );
  });

  it('falls back to the raw value when the base URL cannot be parsed', () => {
    expect(derive('not a url')).toBe('not a url');
  });
});

describe('publish (REST fallback)', () => {
  it('POSTs to the realtime publish endpoint when no socket is connected', async () => {
    const post = jest.fn().mockResolvedValue({ ok: true });
    const client = makeClient('https://api-dev.xenition.com/v1', post);
    await client.publish('tasks', { id: 't_1' });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.REALTIME.PUBLISH, {
      channel: 'tasks',
      payload: { id: 't_1' },
    });
  });
});
