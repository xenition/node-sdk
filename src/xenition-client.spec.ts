import axios, { AxiosInstance } from 'axios';
import { XenitionClient } from './xenition-client';
import { AuthClient } from './auth/auth-client';
import { QueryClient } from './query/query-client';
import { StorageClient } from './storage/storage-client';
import { EmailClient } from './email/email-client';
import { PushClient } from './push/push-client';
import { AiClient } from './ai/ai-client';
import { ChatbotClient } from './chatbot/chatbot-client';
import { VectorClient } from './vector/vector-client';
import { SearchClient } from './search/search-client';
import { PaymentClient } from './payment/payment-client';
import { VideoConferencingClient } from './video/video-client';
import { RealtimeClient } from './realtime/realtime-client';
import { API_ENDPOINTS } from './constants';

jest.mock('axios');
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const requestMock = jest.fn();

beforeEach(() => {
  requestMock.mockReset();
  mockedAxios.create.mockImplementation(
    (config) =>
      ({
        request: requestMock,
        defaults: { ...config, headers: { common: {} } },
      }) as unknown as AxiosInstance,
  );
});

describe('constructor / API key validation', () => {
  it('throws when no API key is given', () => {
    expect(() => new XenitionClient('')).toThrow(/API key is required/);
  });

  it('accepts xen_service_ and xen_anon_ keys without warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    new XenitionClient('xen_service_abc123');
    new XenitionClient('xen_anon_abc123');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns (but does not throw) on an unrecognized key prefix', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new XenitionClient('sk_live_wrong_ecosystem');
    expect(client).toBeInstanceOf(XenitionClient);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('xen_service_'),
    );
    warn.mockRestore();
  });

  it('passes the key and options through to the http layer', () => {
    new XenitionClient('xen_service_abc123', {
      baseUrl: 'https://example.com/v1',
      timeout: 5_000,
    });
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://example.com/v1',
        timeout: 5_000,
        headers: expect.objectContaining({ 'x-api-key': 'xen_service_abc123' }),
      }),
    );
  });
});

describe('sub-clients', () => {
  it('instantiates all 12 modules over the shared http client', () => {
    const client = new XenitionClient('xen_service_abc123');
    expect(client.auth).toBeInstanceOf(AuthClient);
    expect(client.query).toBeInstanceOf(QueryClient);
    expect(client.storage).toBeInstanceOf(StorageClient);
    expect(client.email).toBeInstanceOf(EmailClient);
    expect(client.push).toBeInstanceOf(PushClient);
    expect(client.ai).toBeInstanceOf(AiClient);
    expect(client.chatbot).toBeInstanceOf(ChatbotClient);
    expect(client.vector).toBeInstanceOf(VectorClient);
    expect(client.search).toBeInstanceOf(SearchClient);
    expect(client.payment).toBeInstanceOf(PaymentClient);
    expect(client.videoConferencing).toBeInstanceOf(VideoConferencingClient);
    expect(client.realtime).toBeInstanceOf(RealtimeClient);
    // One HttpClient → one axios instance for the whole client.
    expect(mockedAxios.create).toHaveBeenCalledTimes(1);
  });
});

describe('setHeader', () => {
  it('applies the header to the shared axios defaults', () => {
    const client = new XenitionClient('xen_service_abc123');
    client.setHeader('x-session-token', 'tok_42');
    const instance = mockedAxios.create.mock.results[0]!.value as {
      defaults: { headers: { common: Record<string, string> } };
    };
    expect(instance.defaults.headers.common['x-session-token']).toBe('tok_42');
  });
});

describe('raw', () => {
  it('delegates to the query module raw endpoint', async () => {
    requestMock.mockResolvedValue({
      data: { rows: [{ n: 1 }], rowCount: 1 },
    });
    const client = new XenitionClient('xen_service_abc123');
    const res = await client.raw('SELECT 1 AS n', []);
    expect(res).toEqual({ data: [{ n: 1 }], count: 1 });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: API_ENDPOINTS.QUERY.RAW,
        data: { sql: 'SELECT 1 AS n', params: [] },
      }),
    );
  });
});
