import { cacheSafeRequest } from './http-client';

/** A stand-in for the Workers runtime's Request: it rejects any `cache` mode. */
class WorkersLikeRequest {
  readonly url: string;
  readonly init: (RequestInit & { cache?: string }) | undefined;
  constructor(input: unknown, init?: RequestInit & { cache?: string }) {
    if (init && 'cache' in init) throw new TypeError(`Unsupported cache mode: ${String(init.cache)}`);
    this.url = String(input);
    this.init = init;
  }
}

describe('cacheSafeRequest', () => {
  const Safe = cacheSafeRequest(WorkersLikeRequest as unknown as typeof Request)!;

  it("drops axios's cache: 'default' so a Workers runtime accepts the request", () => {
    expect(() => new WorkersLikeRequest('https://api.example.com', { method: 'GET', cache: 'default' } as RequestInit)).toThrow('Unsupported cache mode');
    const req = new Safe('https://api.example.com', { method: 'GET', cache: 'default' } as RequestInit) as unknown as WorkersLikeRequest;
    expect(req.init).toEqual({ method: 'GET' });
  });

  it('passes an explicit, non-default cache mode through untouched', () => {
    const Recording = class {
      init?: RequestInit & { cache?: string };
      constructor(_input: unknown, init?: RequestInit & { cache?: string }) {
        this.init = init;
      }
    };
    const SafeRecording = cacheSafeRequest(Recording as unknown as typeof Request)!;
    const req = new SafeRecording('https://x', { cache: 'no-store' } as RequestInit) as unknown as InstanceType<typeof Recording>;
    expect(req.init).toEqual({ cache: 'no-store' });
  });

  it('is undefined where there is no Request at all', () => {
    expect(cacheSafeRequest(null as unknown as typeof Request)).toBeUndefined();
  });
});
