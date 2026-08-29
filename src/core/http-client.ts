import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosError,
  GenericAbortSignal,
} from 'axios';
import { XENITION_BASE_URL } from '../constants';
import { XenitionError, XenitionErrorCode, isXenitionErrorCode } from './errors';
import { codeFromEnvelope, messageFromEnvelope } from './error-envelope';

/** Correlates one logical call across the SDK, the gateway and its logs. */
export const REQUEST_ID_HEADER = 'x-request-id';
/** Lets the platform collapse a retried write into one effect. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
/**
 * The longest a `Retry-After` will be honoured inside a single call. Past
 * this the error is surfaced instead: a caller can queue the work, show a
 * message or give up, and none of those are possible while the SDK is
 * silently asleep holding the request open.
 */
export const MAX_RETRY_WAIT_MS = 10_000;

/**
 * How many consecutive unreachable attempts open the circuit.
 *
 * Five, because with the default two retries a single call can already
 * contribute three failed dials: a threshold of five means no one unlucky
 * call can open the circuit on its own — it takes a second call still
 * failing — while an outage costs at most five hanging dials instead of
 * every call in the app paying the full timeout budget.
 */
export const CIRCUIT_FAILURE_THRESHOLD = 5;

/**
 * How long the circuit stays open before a single trial request is allowed
 * through.
 *
 * Ten seconds, the same ceiling as MAX_RETRY_WAIT_MS: that constant already
 * declares the longest this SDK is willing to make a caller wait without
 * telling them anything, and failing fast for longer than that trades one
 * kind of invisible wait for another. It is also roughly a gateway redeploy
 * or cold start, so recovery is noticed on the order of a deploy rather
 * than minutes after it.
 */
export const CIRCUIT_COOL_OFF_MS = 10_000;

/** What the observability hooks are handed. */
export interface RequestEvent {
  method: string;
  url: string;
  requestId: string;
  /** 0 for the first try. */
  attempt: number;
}

export interface ResponseEvent extends RequestEvent {
  status: number;
  durationMs: number;
}

export interface RequestErrorEvent extends RequestEvent {
  durationMs: number;
  error: XenitionError;
  /** True when another attempt follows — so logs do not read as N failures. */
  willRetry: boolean;
}

/** Tuning for the circuit breaker. Both fields have documented defaults. */
export interface CircuitBreakerOptions {
  /** Consecutive unreachable attempts before the circuit opens. */
  failureThreshold?: number;
  /** How long to fail fast before letting one trial request through. */
  coolOffMs?: number;
}

export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
  /**
   * Stop dialling a gateway that has already proved it is down.
   *
   * With retries on, an unreachable gateway makes every call pay the whole
   * timeout budget — 30s × 3 attempts — before failing, so a page with six
   * widgets hangs for minutes to learn one fact it learned in the first
   * three seconds. Once the circuit is open, calls fail immediately for a
   * cool-off window, then ONE trial request is allowed through to test
   * recovery and closes the circuit if it succeeds.
   *
   * Off unless asked for: `true` takes the defaults, an object overrides
   * them. A healthy client behaves identically either way — the counter
   * only ever advances on failures — but failing fast is a policy decision
   * about someone else's app, so it is not made on their behalf.
   *
   * A 4xx never counts. A validation error or a 404 is the caller's own
   * bad request answered by a gateway that is plainly alive, and tripping
   * on those would let one buggy call path black out every other one.
   */
  circuitBreaker?: boolean | CircuitBreakerOptions;
  /**
   * Override the API base URL for this client (e.g. a per-deploy platform
   * URL injected at deploy time). Falls back to XENITION_BASE_URL.
   */
  baseUrl?: string;
  /**
   * Observability hooks. A worker has no console anyone reads, so without
   * these a misbehaving generated app offers nothing to look at.
   *
   * They are advisory: a hook that throws is swallowed, because adding
   * logging must never become a way to break production.
   */
  onRequest?(event: RequestEvent): void;
  onResponse?(event: ResponseEvent): void;
  onError?(event: RequestErrorEvent): void;
}

/** Request config plus the SDK's own per-request options. */
export interface RequestOptions extends AxiosRequestConfig {
  /**
   * Marks this write as safe to repeat.
   *
   * Two effects: the platform can collapse duplicate deliveries into one,
   * and the SDK will RETRY this request on a transient failure — which it
   * refuses to do for an unkeyed write, because a timeout is exactly the
   * case where the first attempt may already have succeeded.
   *
   * Use a key derived from the operation, not a fresh random one per
   * attempt: `order-${orderId}`, not `crypto.randomUUID()` inside the retry
   * loop.
   */
  idempotencyKey?: string;

  /**
   * Abort this request from the outside.
   *
   * The timeout answers "how long will the SDK wait"; only the caller can
   * answer "do I still want this". A search-as-you-type box, a screen the
   * user navigated away from and a React effect that unmounted all need to
   * drop a request in flight, and without this their only options are to
   * hold the socket open or to let a stale answer arrive and overwrite a
   * newer one.
   *
   * An aborted request is never retried. Cancellation is a decision, not a
   * transient failure — retrying it would dial again on behalf of a caller
   * who has just said they no longer want the result.
   */
  signal?: AbortSignal;
}

/**
 * True for the error a cancelled request rejects with.
 *
 * Cancellation is usually the one failure a UI should say NOTHING about:
 * the user navigated away, so a toast reading "request failed" is noise
 * about something they did on purpose. This is the check that lets a catch
 * block far from the AbortController tell that case apart.
 *
 * The error carries the `CANCELLED` code, and this predicate accepts EITHER
 * that code or the `details.cancelled` marker. Both, because the marker also
 * catches a cancellation raised through an AbortController handle this SDK
 * was never given — and because an older build that predates the code still
 * satisfies the predicate, so callers who followed this advice do not have
 * to care which version they are on.
 */
export const isCancelledError = (err: unknown): err is XenitionError =>
  err instanceof XenitionError &&
  (err.code === 'CANCELLED' ||
    (err.details as { cancelled?: boolean } | undefined)?.cancelled === true);

/**
 * Move `idempotencyKey` out of the SDK's options and into the header the
 * platform reads, so nothing downstream has to know both spellings.
 */
function withIdempotency(config?: RequestOptions): AxiosRequestConfig {
  if (!config) return {};
  const { idempotencyKey, ...rest } = config;
  if (!idempotencyKey) return rest;
  return {
    ...rest,
    headers: { ...(rest.headers as Record<string, string> | undefined), [IDEMPOTENCY_HEADER]: idempotencyKey },
  };
}

/** What the breaker says about the attempt that is about to be made. */
type CircuitAdmission = 'closed' | 'trial' | 'blocked';

/**
 * Consecutive-failure circuit breaker, one per HttpClient.
 *
 * The state it tracks is deliberately small: a run of failures, and the
 * moment the circuit opened. Anything richer (rolling windows, failure
 * rates) needs a clock and a history to be worth having, and this runs in
 * a Worker that may be torn down between two requests.
 *
 * "Failure" here means the gateway could not be reached or answered 5xx.
 * A 4xx is not a failure of the gateway, it is an answer from it, so it
 * resets the run — a live gateway is exactly what the counter is looking
 * for evidence of.
 */
class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  /**
   * Set while the one half-open trial request is in flight, so a burst of
   * concurrent calls does not all become trials the moment the cool-off
   * expires — which is the stampede the breaker exists to prevent.
   */
  private trialInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly coolOffMs: number,
  ) {}

  /** Decide, and claim the trial slot if this attempt gets it. */
  admit(): CircuitAdmission {
    if (this.openedAt === null) return 'closed';
    if (Date.now() - this.openedAt < this.coolOffMs) return 'blocked';
    if (this.trialInFlight) return 'blocked';
    this.trialInFlight = true;
    return 'trial';
  }

  /** True when the NEXT attempt would be refused — peeked, not claimed. */
  isBlocking(): boolean {
    if (this.openedAt === null) return false;
    return this.trialInFlight || Date.now() - this.openedAt < this.coolOffMs;
  }

  /** The gateway answered, with anything at all. It is alive. */
  recordReachable(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  /** No answer, or a 5xx. */
  recordUnreachable(): void {
    this.trialInFlight = false;
    this.consecutiveFailures += 1;
    // A failed trial restarts the cool-off rather than adding to it: the
    // gateway is still down, and the next probe should be one window away
    // from this one, not from the original outage.
    if (this.openedAt !== null || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = Date.now();
    }
  }

  /**
   * The attempt was cancelled, so it proved nothing either way. The trial
   * slot must still be handed back — a cancelled probe that kept the slot
   * would leave the circuit blocked with nobody left to test recovery.
   */
  releaseTrial(): void {
    this.trialInFlight = false;
  }

  /** Milliseconds until the next trial is allowed. Zero when closed. */
  msUntilTrial(): number {
    if (this.openedAt === null) return 0;
    return Math.max(0, this.coolOffMs - (Date.now() - this.openedAt));
  }
}

/**
 * Thin axios wrapper used by every SDK module.
 *
 *   - Attaches `x-api-key` on every request (the key the client was
 *     constructed with — encodes app_id + key_type server-side).
 *   - Normalizes the server's `{success, data, error: {code, message}}`
 *     envelope into a plain `data` return (throws a typed XenitionError
 *     on `success: false`).
 *   - Retries idempotent requests on transient failures (network /
 *     5xx) with capped exponential backoff.
 *   - Optionally opens a circuit breaker after a run of unreachable
 *     attempts, so an outage costs a handful of timeouts instead of one
 *     per call.
 *
 * SDK modules never touch axios directly — they use `get/post/patch/del`
 * on this class so error + envelope handling stays in one place.
 */
export class HttpClient {
  private readonly axios: AxiosInstance;
  private readonly retries: number;
  private readonly hooks: Pick<HttpClientOptions, 'onRequest' | 'onResponse' | 'onError'>;
  /** Null unless the caller opted in — see HttpClientOptions.circuitBreaker. */
  private readonly breaker: CircuitBreaker | null;

  constructor(apiKey: string, options: HttpClientOptions = {}) {
    this.retries = options.retries ?? 2;
    this.breaker = this.buildBreaker(options.circuitBreaker);
    this.hooks = {
      onRequest: options.onRequest,
      onResponse: options.onResponse,
      onError: options.onError,
    };
    this.axios = axios.create({
      baseURL: options.baseUrl || XENITION_BASE_URL,
      timeout: options.timeout ?? 30_000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...options.headers,
      },
    });
  }

  setHeader(key: string, value: string): void {
    this.axios.defaults.headers.common[key] = value;
  }

  /**
   * The effective API base URL this client was constructed with (the
   * per-deploy override when given, otherwise XENITION_BASE_URL). Used by
   * the realtime module to derive the socket origin.
   */
  get baseUrl(): string {
    return this.axios.defaults.baseURL || XENITION_BASE_URL;
  }

  get<T>(url: string, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'GET', url });
  }

  post<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'POST', url, data: body });
  }

  patch<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'PATCH', url, data: body });
  }

  put<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'PUT', url, data: body });
  }

  del<T>(url: string, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'DELETE', url });
  }

  /**
   * Multipart form upload. Pass a form-data instance (Node) or a Web
   * FormData — axios handles both. Content-Type (including the boundary)
   * is set automatically; we strip our default JSON header so it isn't
   * sent alongside.
   */
  postForm<T>(
    url: string,
    form: unknown,
    config?: RequestOptions,
  ): Promise<T> {
    const maybeHeaders =
      typeof (form as { getHeaders?: () => Record<string, string> }).getHeaders === 'function'
        ? (form as { getHeaders: () => Record<string, string> }).getHeaders()
        : undefined;
    const lifted = withIdempotency(config);
    const merged: AxiosRequestConfig = {
      ...lifted,
      method: 'POST',
      url,
      data: form,
      headers: {
        ...(maybeHeaders ?? {}),
        ...((lifted.headers ?? {}) as Record<string, string>),
        // Override the default application/json so the boundary sticks.
        'Content-Type': maybeHeaders?.['content-type'] ?? 'multipart/form-data',
      },
    };
    return this.request<T>(merged);
  }

  /**
   * POST and hand back the raw `Response`, body unread.
   *
   * The one call that deliberately bypasses axios and the envelope. Both
   * exist to give callers a finished value, which is exactly wrong for a
   * stream: by the time axios resolves, the body it was supposed to deliver
   * incrementally has already been buffered.
   *
   * The caller owns the body and must consume or cancel it. Errors are still
   * normalized, so a failed stream throws the same `XenitionError` shape as
   * everything else rather than a bare Response.
   */
  async stream(url: string, body?: unknown, config: RequestOptions = {}): Promise<Response> {
    const fetchImpl = globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new XenitionError(
        'NETWORK_ERROR',
        'HttpClient.stream: no global fetch available in this runtime.',
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      [REQUEST_ID_HEADER]: this.newRequestId(),
      ...(this.axios.defaults.headers.common as Record<string, string>),
      ...((config.headers ?? {}) as Record<string, string>),
    };
    const apiKey = this.axios.defaults.headers['x-api-key'];
    if (typeof apiKey === 'string') headers['x-api-key'] = apiKey;

    // The signal is forwarded rather than ignored because a stream is the
    // call a caller is MOST likely to abandon — a user who stops a
    // half-generated answer — and accepting `signal` on RequestOptions and
    // then dropping it here would hold the model's output open with nobody
    // reading it.
    let response: Response;
    try {
      response = await fetchImpl(`${this.baseUrl}${url}`, {
        method: 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: config.signal,
      });
    } catch (err) {
      if (this.wasCancelled(config.signal, err)) throw this.cancellationError('POST', url);
      throw this.normalizeError(err);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // The body is usually JSON even on the streaming route, so prefer the
      // sentence inside it over dumping the raw envelope at the caller.
      let parsed: unknown;
      try {
        parsed = detail ? JSON.parse(detail) : undefined;
      } catch {
        parsed = undefined;
      }
      const message =
        messageFromEnvelope(parsed) ??
        (detail ? detail.slice(0, 300) : `Request failed with ${response.status}`);
      throw new XenitionError(
        this.classifyStatus(response.status, codeFromEnvelope(parsed)),
        message,
        { status: response.status, details: parsed ?? detail },
      );
    }
    return response;
  }

  // ────────── Internals ────────────────────────────────────────────────────

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    const method = (config.method ?? 'GET').toUpperCase();
    const url = config.url ?? '';
    const headers = (config.headers ?? {}) as Record<string, unknown>;
    const requestId = String(headers[REQUEST_ID_HEADER] ?? this.newRequestId());
    const idempotencyKey = headers[IDEMPOTENCY_HEADER];

    const merged: AxiosRequestConfig = {
      ...config,
      headers: { ...headers, [REQUEST_ID_HEADER]: requestId },
    };

    // A GET is retriable because it changes nothing. A write is retriable
    // ONLY when it carries an idempotency key: without one, a retry after a
    // timeout can apply the same change twice — and a timeout is exactly the
    // case where the first attempt may well have succeeded.
    const retriable = method === 'GET' || typeof idempotencyKey === 'string';
    const maxAttempts = retriable ? 1 + this.retries : 1;
    let lastErr: unknown;

    // A signal that is already aborted when the call is made — the common
    // shape of "the component unmounted before the effect ran" — must not
    // reach the network at all. Axios would dial and then cancel, which
    // costs a connection and, for a write, may still apply the change.
    if (config.signal?.aborted) throw this.cancellationError(method, url);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const admission = this.breaker?.admit() ?? 'closed';
      if (admission === 'blocked') {
        // Deliberately no onRequest event: nothing was requested. The
        // onError event still fires, because a fail-fast IS the outage as
        // far as the caller's logs are concerned.
        const openErr = this.circuitOpenError(method, url);
        this.observe('onError', {
          method,
          url,
          requestId,
          attempt,
          durationMs: 0,
          error: openErr,
          willRetry: false,
        });
        throw openErr;
      }

      const startedAt = Date.now();
      let answered = false;
      this.observe('onRequest', { method, url, requestId, attempt });
      try {
        const response = await this.axios.request(merged);
        // Recorded before the envelope is unwrapped: `{success: false}`
        // arrives over a working connection from a gateway that is plainly
        // up, and it must not be mistaken for the gateway being down.
        answered = true;
        this.breaker?.recordReachable();
        this.observe('onResponse', {
          method,
          url,
          requestId,
          attempt,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return this.unwrapEnvelope<T>(response.data);
      } catch (err) {
        lastErr = err;
        const cancelled = this.wasCancelled(config.signal, err);
        const xenitionErr = cancelled
          ? this.cancellationError(method, url)
          : this.normalizeError(err);
        if (!answered) this.recordAttemptOutcome(cancelled, xenitionErr);
        // A 429 says when it will serve again. If that is further off than we
        // are willing to hold a request open, fail now and let the caller
        // decide — sleeping for two minutes inside one call is worse than an
        // error, because the caller cannot see it happening.
        const retryAfterMs = this.retryAfterMs(err);
        const waitsTooLong = retryAfterMs !== null && retryAfterMs > MAX_RETRY_WAIT_MS;
        const willRetry =
          // Cancellation first, and unconditionally: the caller has said they
          // no longer want the result, so dialling again on their behalf is
          // the one thing they explicitly asked us not to do.
          !cancelled &&
          this.shouldRetry(xenitionErr) &&
          attempt < maxAttempts - 1 &&
          !waitsTooLong &&
          // If the failure just recorded opened the circuit, the remaining
          // attempts of THIS call would only spend the caller's time dialling
          // a gateway we have already concluded is down.
          !(this.breaker?.isBlocking() ?? false);
        this.observe('onError', {
          method,
          url,
          requestId,
          attempt,
          durationMs: Date.now() - startedAt,
          error: xenitionErr,
          willRetry,
        });
        if (!willRetry) throw xenitionErr;
        await this.sleep(retryAfterMs ?? this.jitteredBackoffMs(attempt));
      }
    }
    // Unreachable; TypeScript wants it.
    throw this.normalizeError(lastErr);
  }

  /**
   * Hooks are observability, so a throwing hook must never become the
   * request's failure — that would make adding logging a way to break
   * production.
   */
  private observe<K extends 'onRequest' | 'onResponse' | 'onError'>(
    hook: K,
    event: Parameters<NonNullable<HttpClientOptions[K]>>[0],
  ): void {
    const handler = this.hooks[hook] as ((e: unknown) => void) | undefined;
    if (!handler) return;
    try {
      handler(event);
    } catch {
      /* ignored on purpose */
    }
  }

  private buildBreaker(option: HttpClientOptions['circuitBreaker']): CircuitBreaker | null {
    if (!option) return null;
    const tuning = option === true ? {} : option;
    return new CircuitBreaker(
      tuning.failureThreshold ?? CIRCUIT_FAILURE_THRESHOLD,
      tuning.coolOffMs ?? CIRCUIT_COOL_OFF_MS,
    );
  }

  /**
   * Teach the breaker what this attempt proved about the gateway.
   *
   * Only two things count as the gateway being down: nothing came back at
   * all (`status === null` — a socket error, a DNS failure, our own
   * timeout), or it came back a 5xx. Every other status is an answer, and
   * an answer means it is up — including a 429, where it is not only up
   * but actively telling us so.
   */
  private recordAttemptOutcome(cancelled: boolean, err: XenitionError): void {
    if (!this.breaker) return;
    if (cancelled) {
      this.breaker.releaseTrial();
      return;
    }
    if (err.status === null || err.status >= 500) this.breaker.recordUnreachable();
    else this.breaker.recordReachable();
  }

  /**
   * Whether this failure is the caller's own abort rather than a fault.
   *
   * The signal is checked first because it is the one source that cannot
   * lie: whatever shape the runtime's rejection took — axios's
   * `CanceledError`, a DOM `AbortError`, a bare `ERR_CANCELED` — if the
   * caller's signal is aborted then the request ended because they said so.
   * The name/code checks catch a signal aborted through a different handle
   * than the one we were given.
   */
  private wasCancelled(signal: GenericAbortSignal | undefined, err: unknown): boolean {
    if (signal?.aborted) return true;
    const { name, code } = (err ?? {}) as { name?: string; code?: string };
    return code === 'ERR_CANCELED' || name === 'CanceledError' || name === 'AbortError';
  }

  /**
   * `UNKNOWN` is not a great fit and is chosen knowingly: no member of
   * `XenitionErrorCode` means "the caller stopped this", and that union
   * lives in errors.ts. Rather than borrow `TIMEOUT` or `NETWORK_ERROR` —
   * both of which would tell an on-call engineer the network misbehaved
   * when nothing did, and both of which a caller's own retry wrapper would
   * happily retry — the honest fallback carries a marker in `details` that
   * `isCancelledError` reads.
   */
  private cancellationError(method: string, url: string): XenitionError {
    // `details.cancelled` stays alongside the code. `isCancelledError` reads
    // the marker, so a cancellation this SDK did not mint — one raised
    // through an AbortController handle we were never given — is still
    // recognised by the same predicate callers already use.
    return new XenitionError(
      'CANCELLED',
      `${method} ${url} was cancelled by the caller.`,
      { details: { cancelled: true } },
    );
  }

  /**
   * `NETWORK_ERROR` on purpose: this is the error the caller would have got
   * from the dial we skipped, so an app that already handles an unreachable
   * gateway handles this too, and nobody has to learn a new code to cope
   * with an outage being detected faster.
   */
  private circuitOpenError(method: string, url: string): XenitionError {
    const waitMs = this.breaker?.msUntilTrial() ?? 0;
    return new XenitionError(
      'NETWORK_ERROR',
      `${method} ${url} failed fast: the gateway has been failing, so the SDK ` +
        `stopped dialling it. It will try again in ${Math.ceil(waitMs / 1000)}s.`,
    );
  }

  private newRequestId(): string {
    const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return webCrypto?.randomUUID ? webCrypto.randomUUID() : `req_${Date.now().toString(36)}`;
  }

  /**
   * Server returns either a raw JSON object or the envelope:
   *   { success: true,  data: ... }
   *   { success: false, error: { code, message } }
   * Unwrap uniformly.
   */
  private unwrapEnvelope<T>(body: unknown): T {
    if (body && typeof body === 'object' && 'success' in body) {
      const env = body as {
        success: boolean;
        data?: T;
        error?: { code?: string; message?: string };
      };
      if (env.success === false) {
        // No HTTP status here (2xx body with success:false), so unknown
        // server codes fall back to 'UNKNOWN'. The raw code survives in
        // `details` (the whole error object) either way.
        const rawCode = codeFromEnvelope(env);
        const code: XenitionErrorCode = isXenitionErrorCode(rawCode)
          ? rawCode
          : 'UNKNOWN';
        const message = messageFromEnvelope(env) ?? 'Request failed';
        throw new XenitionError(code, message, { details: env.error ?? env });
      }
      return env.data as T;
    }
    return body as T;
  }

  private normalizeError(err: unknown): XenitionError {
    if (err instanceof XenitionError) return err;
    if (axios.isAxiosError(err)) {
      const axErr = err as AxiosError<unknown>;
      const status = axErr.response?.status ?? null;
      const envelope = axErr.response?.data;
      const code = this.classifyStatus(status, codeFromEnvelope(envelope));
      // The server's own sentence, whichever envelope it arrived in.
      // Falling back to axios's message means surfacing "Request failed
      // with status code 409" to a sign-up screen, which tells the user
      // nothing and hides the sentence the server did send.
      const message = messageFromEnvelope(envelope) ?? axErr.message ?? 'Request failed';
      return new XenitionError(code, message, { status, details: envelope });
    }
    if (err instanceof Error) {
      return new XenitionError('UNKNOWN', err.message);
    }
    return new XenitionError('UNKNOWN', 'Unknown error', { details: err });
  }

  private classifyStatus(
    status: number | null,
    serverCode?: string,
  ): XenitionErrorCode {
    // Only accept codes that are actually in the XenitionErrorCode union —
    // unknown server codes fall through to status-based classification.
    // The raw server code is not lost: normalizeError stores the full
    // response envelope (including `error.code`) in the error's `details`.
    if (isXenitionErrorCode(serverCode)) {
      return serverCode;
    }
    if (status === null) return 'NETWORK_ERROR';
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 401) return 'AUTH_INVALID_TOKEN';
    if (status === 403) return 'AUTH_FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500) return 'SERVER_ERROR';
    return 'UNKNOWN';
  }

  /**
   * `RATE_LIMITED` is here on purpose. A 429 is the most retriable failure
   * there is — the server is not broken, it is asking us to come back — and
   * it is the one an app hits in normal operation rather than in an outage.
   * Retrying it is still gated on the request being idempotent, so a
   * non-keyed POST throttled at the door is surfaced, not replayed.
   */
  private shouldRetry(err: XenitionError): boolean {
    return (
      err.code === 'NETWORK_ERROR' ||
      err.code === 'TIMEOUT' ||
      err.code === 'RATE_LIMITED' ||
      err.code === 'SERVER_ERROR'
    );
  }

  /**
   * `Retry-After`, in milliseconds, or null when the response did not carry
   * one. Both forms of the header are legal: delay-seconds, and an HTTP date.
   */
  private retryAfterMs(err: unknown): number | null {
    const headers = (err as { response?: { headers?: Record<string, unknown> } })?.response
      ?.headers;
    const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (raw === undefined || raw === null) return null;

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const when = Date.parse(String(raw));
    if (Number.isNaN(when)) return null;
    return Math.max(0, when - Date.now());
  }

  /**
   * Exponential backoff with **full jitter** — a random wait between zero and
   * the curve, not the curve itself.
   *
   * Without jitter, every client that failed in the same second retries in
   * the same second, and the blip they were all waiting out becomes a
   * thundering herd the moment the server comes back. Spreading the retries
   * is what lets it recover.
   */
  private jitteredBackoffMs(attempt: number): number {
    const ceiling = Math.min(100 * Math.pow(2, attempt), 2000);
    return Math.round(Math.random() * ceiling);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
