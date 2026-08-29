import { AxiosRequestConfig } from 'axios';
import { XenitionError } from './errors';
/** Correlates one logical call across the SDK, the gateway and its logs. */
export declare const REQUEST_ID_HEADER = "x-request-id";
/** Lets the platform collapse a retried write into one effect. */
export declare const IDEMPOTENCY_HEADER = "idempotency-key";
/**
 * The longest a `Retry-After` will be honoured inside a single call. Past
 * this the error is surfaced instead: a caller can queue the work, show a
 * message or give up, and none of those are possible while the SDK is
 * silently asleep holding the request open.
 */
export declare const MAX_RETRY_WAIT_MS = 10000;
/**
 * How many consecutive unreachable attempts open the circuit.
 *
 * Five, because with the default two retries a single call can already
 * contribute three failed dials: a threshold of five means no one unlucky
 * call can open the circuit on its own — it takes a second call still
 * failing — while an outage costs at most five hanging dials instead of
 * every call in the app paying the full timeout budget.
 */
export declare const CIRCUIT_FAILURE_THRESHOLD = 5;
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
export declare const CIRCUIT_COOL_OFF_MS = 10000;
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
export declare const isCancelledError: (err: unknown) => err is XenitionError;
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
export declare class HttpClient {
    private readonly axios;
    private readonly retries;
    private readonly hooks;
    /** Null unless the caller opted in — see HttpClientOptions.circuitBreaker. */
    private readonly breaker;
    constructor(apiKey: string, options?: HttpClientOptions);
    setHeader(key: string, value: string): void;
    /**
     * The effective API base URL this client was constructed with (the
     * per-deploy override when given, otherwise XENITION_BASE_URL). Used by
     * the realtime module to derive the socket origin.
     */
    get baseUrl(): string;
    get<T>(url: string, config?: RequestOptions): Promise<T>;
    post<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T>;
    patch<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T>;
    put<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T>;
    del<T>(url: string, config?: RequestOptions): Promise<T>;
    /**
     * Multipart form upload. Pass a form-data instance (Node) or a Web
     * FormData — axios handles both. Content-Type (including the boundary)
     * is set automatically; we strip our default JSON header so it isn't
     * sent alongside.
     */
    postForm<T>(url: string, form: unknown, config?: RequestOptions): Promise<T>;
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
    stream(url: string, body?: unknown, config?: RequestOptions): Promise<Response>;
    private request;
    /**
     * Hooks are observability, so a throwing hook must never become the
     * request's failure — that would make adding logging a way to break
     * production.
     */
    private observe;
    private buildBreaker;
    /**
     * Teach the breaker what this attempt proved about the gateway.
     *
     * Only two things count as the gateway being down: nothing came back at
     * all (`status === null` — a socket error, a DNS failure, our own
     * timeout), or it came back a 5xx. Every other status is an answer, and
     * an answer means it is up — including a 429, where it is not only up
     * but actively telling us so.
     */
    private recordAttemptOutcome;
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
    private wasCancelled;
    /**
     * `UNKNOWN` is not a great fit and is chosen knowingly: no member of
     * `XenitionErrorCode` means "the caller stopped this", and that union
     * lives in errors.ts. Rather than borrow `TIMEOUT` or `NETWORK_ERROR` —
     * both of which would tell an on-call engineer the network misbehaved
     * when nothing did, and both of which a caller's own retry wrapper would
     * happily retry — the honest fallback carries a marker in `details` that
     * `isCancelledError` reads.
     */
    private cancellationError;
    /**
     * `NETWORK_ERROR` on purpose: this is the error the caller would have got
     * from the dial we skipped, so an app that already handles an unreachable
     * gateway handles this too, and nobody has to learn a new code to cope
     * with an outage being detected faster.
     */
    private circuitOpenError;
    private newRequestId;
    /**
     * Server returns either a raw JSON object or the envelope:
     *   { success: true,  data: ... }
     *   { success: false, error: { code, message } }
     * Unwrap uniformly.
     */
    private unwrapEnvelope;
    private normalizeError;
    private classifyStatus;
    /**
     * `RATE_LIMITED` is here on purpose. A 429 is the most retriable failure
     * there is — the server is not broken, it is asking us to come back — and
     * it is the one an app hits in normal operation rather than in an outage.
     * Retrying it is still gated on the request being idempotent, so a
     * non-keyed POST throttled at the door is surfaced, not replayed.
     */
    private shouldRetry;
    /**
     * `Retry-After`, in milliseconds, or null when the response did not carry
     * one. Both forms of the header are legal: delay-seconds, and an HTTP date.
     */
    private retryAfterMs;
    /**
     * Exponential backoff with **full jitter** — a random wait between zero and
     * the curve, not the curve itself.
     *
     * Without jitter, every client that failed in the same second retries in
     * the same second, and the blip they were all waiting out becomes a
     * thundering herd the moment the server comes back. Spreading the retries
     * is what lets it recover.
     */
    private jitteredBackoffMs;
    private sleep;
}
//# sourceMappingURL=http-client.d.ts.map