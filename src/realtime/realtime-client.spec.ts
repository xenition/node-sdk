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

/**
 * A socket.io stand-in whose lifecycle events can be fired by hand.
 * `connected` starts false and flips when a 'connect' is delivered.
 */
const fakeSocket = () => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    connected: false,
    emit: jest.fn(),
    disconnect: jest.fn(),
    on(event: string, handler: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return socket;
    },
    fire(event: string, ...args: unknown[]) {
      if (event === 'connect') socket.connected = true;
      for (const handler of listeners.get(event) ?? []) handler(...args);
    },
  };
  return socket;
};

/** Every `subscribe` the client emitted, in order. */
const subscribedChannels = (socket: ReturnType<typeof fakeSocket>): string[] =>
  socket.emit.mock.calls
    .filter(([event]) => event === 'subscribe')
    .map(([, payload]) => (payload as { channel: string }).channel);

describe('RealtimeClient — surviving a reconnect', () => {
  const io = jest.requireMock('socket.io-client').io as jest.Mock;

  beforeEach(() => io.mockReset());

  it('re-subscribes every live channel when the socket comes back', async () => {
    // The server holds subscriptions per CONNECTION. Without the replay, a
    // phone that loses signal for two seconds comes back with a live socket,
    // a full handler map, and no events ever again — silently.
    const socket = fakeSocket();
    io.mockReturnValue(socket);
    const client = makeClient('https://api-dev.xenition.com/v1');

    client.subscribe('tasks', () => {});
    client.subscribe('orders', () => {});
    socket.fire('connect');
    await Promise.resolve();
    await Promise.resolve();

    const beforeDrop = subscribedChannels(socket).length;
    socket.fire('disconnect');
    socket.fire('connect');

    expect(subscribedChannels(socket).slice(beforeDrop).sort()).toEqual(['orders', 'tasks']);
  });

  it('does not double-subscribe on the first connect', async () => {
    // The initial subscribe is ensureSubscribed's job, per channel.
    const socket = fakeSocket();
    io.mockReturnValue(socket);
    const client = makeClient('https://api-dev.xenition.com/v1');

    client.subscribe('tasks', () => {});
    socket.fire('connect');
    await Promise.resolve();
    await Promise.resolve();

    expect(subscribedChannels(socket)).toEqual(['tasks']);
  });

  it('drops a channel from the replay once nothing listens to it', async () => {
    const socket = fakeSocket();
    io.mockReturnValue(socket);
    const client = makeClient('https://api-dev.xenition.com/v1');

    const sub = client.subscribe('tasks', () => {});
    client.subscribe('orders', () => {});
    socket.fire('connect');
    await Promise.resolve();
    await Promise.resolve();
    sub.unsubscribe();

    const beforeDrop = subscribedChannels(socket).length;
    socket.fire('connect');
    expect(subscribedChannels(socket).slice(beforeDrop)).toEqual(['orders']);
  });

  it('closes a socket that never connected instead of leaving it retrying', async () => {
    // reconnection:true means an orphan keeps dialling forever behind a
    // promise nobody holds.
    const socket = fakeSocket();
    io.mockReturnValue(socket);
    const client = makeClient('https://api-dev.xenition.com/v1');

    const pending = client['connect']();
    socket.fire('connect_error', new Error('refused'));

    await expect(pending).rejects.toThrow('refused');
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('ignores connect_error once connected — socket.io is retrying', async () => {
    const socket = fakeSocket();
    io.mockReturnValue(socket);
    const client = makeClient('https://api-dev.xenition.com/v1');

    client.subscribe('tasks', () => {});
    socket.fire('connect');
    await Promise.resolve();
    socket.fire('connect_error', new Error('blip'));

    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
