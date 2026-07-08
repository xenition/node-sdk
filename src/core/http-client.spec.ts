import axios, { AxiosInstance } from 'axios';
import { HttpClient } from './http-client';
import { XenitionError } from './errors';
import { XENITION_BASE_URL } from '../constants';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** The `request` fn on the axios instance returned by axios.create(). */
const requestMock = jest.fn();

/** Build a fake AxiosError-shaped rejection (isAxiosError duck-typed). */
const axiosError = (
  status: number | null,
  data?: unknown,
  message = 'Request failed',
) => ({
  isAxiosError: true,
  message,
  response: status === null ? undefined : { status, data },
});

beforeEach(() => {
  requestMock.mockReset();
  mockedAxios.create.mockImplementation(
    (config) =>
      ({
        request: requestMock,
        defaults: { ...config, headers: { common: {} } },
      }) as unknown as AxiosInstance,
  );
  (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
    (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError),
  );
});

const makeClient = (retries = 0) =>
  new HttpClient('xen_service_test', { retries });

const caughtError = async (p: Promise<unknown>): Promise<XenitionError> => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(XenitionError);
    return err as XenitionError;
  }
  throw new Error('expected promise to reject');
};

describe('envelope unwrapping', () => {
  it('unwraps {success: true, data} to the payload', async () => {
    requestMock.mockResolvedValue({
      data: { success: true, data: { id: 'u_1' } },
    });
    await expect(makeClient().get('/x')).resolves.toEqual({ id: 'u_1' });
  });

  it('passes non-envelope bodies through untouched', async () => {
    requestMock.mockResolvedValue({ data: { rows: [1, 2], rowCount: 2 } });
    await expect(makeClient().get('/x')).resolves.toEqual({
      rows: [1, 2],
      rowCount: 2,
    });
  });

  it('throws a typed error on {success: false} with a known code', async () => {
    requestMock.mockResolvedValue({
      data: {
        success: false,
        error: { code: 'QUERY_FAILED', message: 'bad query' },
      },
    });
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('QUERY_FAILED');
    expect(err.message).toBe('bad query');
  });

  it('falls back to UNKNOWN for unrecognized envelope codes, keeping the raw code in details', async () => {
    requestMock.mockResolvedValue({
      data: {
        success: false,
        error: { code: 'SOME_NEW_SERVER_CODE', message: 'novel failure' },
      },
    });
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('novel failure');
    expect(err.details).toEqual({
      code: 'SOME_NEW_SERVER_CODE',
      message: 'novel failure',
    });
  });

  it('handles {success: false} with no error object at all', async () => {
    requestMock.mockResolvedValue({ data: { success: false } });
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('Request failed');
  });
});

describe('error classification (HTTP status → code)', () => {
  const cases: Array<[number | null, string]> = [
    [null, 'NETWORK_ERROR'],
    [400, 'VALIDATION_ERROR'],
    [401, 'AUTH_INVALID_TOKEN'],
    [403, 'AUTH_FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
    [418, 'UNKNOWN'],
  ];

  it.each(cases)('status %p → %s', async (status, expected) => {
    requestMock.mockRejectedValue(axiosError(status));
    const err = await caughtError(makeClient().get('/x'));
    expect(err.code).toBe(expected);
    expect(err.status).toBe(status);
  });

  it('prefers a valid server error.code over the status mapping', async () => {
    requestMock.mockRejectedValue(
      axiosError(401, {
        success: false,
        error: { code: 'AUTH_EXPIRED_TOKEN', message: 'token expired' },
      }),
    );
    const err = await caughtError(makeClient().get('/x'));
    expect(err.code).toBe('AUTH_EXPIRED_TOKEN');
    expect(err.message).toBe('token expired');
  });

  it('ignores unknown server codes and classifies by status, preserving the raw code in details', async () => {
    requestMock.mockRejectedValue(
      axiosError(404, {
        success: false,
        error: { code: 'TEAPOT_EXPLODED', message: 'gone' },
      }),
    );
    const err = await caughtError(makeClient().get('/x'));
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('gone');
    // Nothing lost: the raw server code rides along in details.
    expect(err.details).toEqual({
      success: false,
      error: { code: 'TEAPOT_EXPLODED', message: 'gone' },
    });
  });

  it('wraps non-axios errors as UNKNOWN', async () => {
    requestMock.mockRejectedValue(new Error('something odd'));
    const err = await caughtError(makeClient().post('/x'));
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('something odd');
  });

  it('re-throws XenitionErrors untouched', async () => {
    const original = new XenitionError('CONFLICT', 'already exists');
    requestMock.mockRejectedValue(original);
    const err = await caughtError(makeClient().post('/x'));
    expect(err).toBe(original);
  });
});

describe('retry behavior', () => {
  it('retries GETs on transient 5xx and succeeds', async () => {
    requestMock
      .mockRejectedValueOnce(axiosError(500))
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce({ data: { success: true, data: 'ok' } });
    await expect(makeClient(2).get('/x')).resolves.toBe('ok');
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('retries GETs on network errors', async () => {
    requestMock
      .mockRejectedValueOnce(axiosError(null))
      .mockResolvedValueOnce({ data: { success: true, data: 'ok' } });
    await expect(makeClient(1).get('/x')).resolves.toBe('ok');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const err = await caughtError(makeClient(1).get('/x'));
    expect(err.code).toBe('SERVER_ERROR');
    expect(requestMock).toHaveBeenCalledTimes(2); // 1 + 1 retry
  });

  it('does not retry GETs on non-transient errors', async () => {
    requestMock.mockRejectedValue(axiosError(404));
    await caughtError(makeClient(2).get('/x'));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('never retries non-idempotent POSTs, even on 5xx', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    const err = await caughtError(makeClient(2).post('/x', { a: 1 }));
    expect(err.code).toBe('SERVER_ERROR');
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('never retries DELETEs', async () => {
    requestMock.mockRejectedValue(axiosError(500));
    await caughtError(makeClient(2).del('/x'));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe('verbs and configuration', () => {
  it('routes each verb with the right method and body', async () => {
    requestMock.mockResolvedValue({ data: { success: true, data: null } });
    const client = makeClient();
    await client.get('/g');
    await client.post('/p', { a: 1 });
    await client.patch('/pa', { b: 2 });
    await client.put('/pu', { c: 3 });
    await client.del('/d');

    const calls = requestMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      expect.objectContaining({ method: 'GET', url: '/g' }),
      expect.objectContaining({ method: 'POST', url: '/p', data: { a: 1 } }),
      expect.objectContaining({ method: 'PATCH', url: '/pa', data: { b: 2 } }),
      expect.objectContaining({ method: 'PUT', url: '/pu', data: { c: 3 } }),
      expect.objectContaining({ method: 'DELETE', url: '/d' }),
    ]);
  });

  it('sends the api key header and honors the baseUrl override', () => {
    new HttpClient('xen_service_test', { baseUrl: 'https://example.com/v1' });
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://example.com/v1',
        headers: expect.objectContaining({ 'x-api-key': 'xen_service_test' }),
      }),
    );
  });

  it('exposes the effective baseUrl (override or default)', () => {
    const overridden = new HttpClient('xen_service_test', {
      baseUrl: 'https://example.com/v1',
    });
    expect(overridden.baseUrl).toBe('https://example.com/v1');

    const plain = new HttpClient('xen_service_test');
    expect(plain.baseUrl).toBe(XENITION_BASE_URL);
  });

  it('setHeader mutates the shared default headers', () => {
    const client = makeClient();
    client.setHeader('x-session-token', 'tok_123');
    const instance = mockedAxios.create.mock.results[0]!.value as {
      defaults: { headers: { common: Record<string, string> } };
    };
    expect(instance.defaults.headers.common['x-session-token']).toBe('tok_123');
  });
});
