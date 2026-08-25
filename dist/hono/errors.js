"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotConfiguredError = void 0;
exports.scrubMessage = scrubMessage;
exports.honoErrorHandler = honoErrorHandler;
exports.jsonNotFound = jsonNotFound;
exports.badRequest = badRequest;
exports.unauthorized = unauthorized;
exports.forbidden = forbidden;
exports.paymentRequiredBody = paymentRequiredBody;
exports.paymentRequired = paymentRequired;
const http_exception_1 = require("hono/http-exception");
const errors_1 = require("../core/errors");
const client_1 = require("./client");
const GENERIC_UPSTREAM = 'Upstream request failed.';
const GENERIC_INTERNAL = 'Internal error.';
/** Belt-and-braces: strip anything key- or URL-shaped from 4xx messages. */
function scrubMessage(message) {
    return message
        .replace(/xen_(?:service|anon)_[A-Za-z0-9]+/g, '[redacted]')
        .replace(/https?:\/\/[^\s"')]+/gi, '[redacted]');
}
function statusForCode(code) {
    switch (code) {
        case 'VALIDATION_ERROR':
            return 400;
        case 'NOT_FOUND':
            return 404;
        case 'CONFLICT':
            return 409;
        case 'RATE_LIMITED':
            return 429;
        case 'TIMEOUT':
            return 504;
        case 'NETWORK_ERROR':
        case 'SERVER_ERROR':
            return 502;
        default:
            // AUTH_* here means the worker's own service key was rejected —
            // an upstream/config problem, not the browser caller's fault.
            return code.startsWith('AUTH_') ? 502 : 500;
    }
}
/**
 * Plain `Error`s thrown by the module clients' own validation
 * (`fail(context, …)` → "FormsClient.submit: …"). These are client-input
 * problems, not bugs, so they become 400s — except "unknown form/
 * collection", which is a 404.
 */
const SDK_VALIDATION_RE = /^[A-Z][A-Za-z]*Client\.[A-Za-z]+: /;
const SDK_NOT_FOUND_RE = /unknown (form|collection|event|resource|cart|order) /;
function errorBody(code, message) {
    return { error: { code, message } };
}
/**
 * Status → body for a thrown `HTTPException` that carries no Response of
 * its own.
 *
 * The codes are deliberately the ones the helpers at the bottom of this
 * file already emit: 401 is `UNAUTHORIZED` because `unauthorized()` says
 * `UNAUTHORIZED`, not because 401 has one obvious name. Two codes for one
 * condition is the exact defect this table exists to avoid — a client
 * branching on `error.code` must not have to know whether the refusal came
 * from an SDK helper or from a route that threw.
 *
 * The message is the fallback: `new HTTPException(404)` leaves `message`
 * empty, and an empty string in the body tells the client nothing.
 */
const HTTP_EXCEPTION_ERRORS = {
    400: { code: 'VALIDATION_ERROR', message: 'Invalid request.' },
    401: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
    402: { code: 'PAYMENT_REQUIRED', message: 'Payment required.' },
    403: { code: 'FORBIDDEN', message: 'Not allowed.' },
    404: { code: 'NOT_FOUND', message: 'Not found.' },
    409: { code: 'CONFLICT', message: 'Conflict.' },
};
/**
 * Hono's own way to refuse a request — `throw new HTTPException(404, …)`.
 *
 * This handler is installed on every built-in router AND on every custom
 * one `buildCustomRouter` mounts, so an app's routes throw straight into
 * it. Until this branch existed an `HTTPException` matched none of the
 * cases below it and fell through to the generic 500: an app's validation
 * errors and ownership checks all answered `{"error":{"code":"INTERNAL"}}`,
 * and a paywall throwing `HTTPException(402)` never reached the client at
 * all — the one status the app most needed to act on.
 *
 * Two things this must not do. It must not call Hono's `getResponse()`,
 * whose default body is text/plain: an API that answers JSON for every
 * error above and prose for these cannot be parsed by one client. And it
 * must not rebuild an exception that already carries its own `res` — that
 * is how a caller attaches a typed body (`paymentRequiredBody` is meant to
 * be thrown that way), and rebuilding would discard it.
 */
/**
 * Is this Hono's `HTTPException`, from ANY copy of hono?
 *
 * `instanceof` is not enough, and the reason is worth stating plainly because
 * it silently disabled this entire branch once already.
 *
 * The SDK is published as CommonJS; a modern Hono app is ESM. `hono` ships
 * both, so `require('hono/http-exception')` and `import 'hono/http-exception'`
 * resolve to two DIFFERENT module instances holding two different
 * `HTTPException` classes. An exception thrown by an ESM app therefore fails
 * `instanceof` against the class this CJS file imported — and fell through to
 * the generic 500 that this branch exists to prevent. Verified 2026-08-25:
 * `esmClass === cjsClass` is `false`.
 *
 * So the check is structural. `status: number` plus a `getResponse` method is
 * HTTPException's whole signature and nothing else in this handler's path
 * carries both — `XenitionError` has a string `code`, not a numeric `status`.
 * The `instanceof` stays as the fast path for the same-instance case.
 */
function isHttpException(err) {
    if (err instanceof http_exception_1.HTTPException)
        return true;
    if (!(err instanceof Error))
        return false;
    const candidate = err;
    return (typeof candidate.status === 'number' &&
        candidate.status >= 100 &&
        candidate.status <= 599 &&
        typeof candidate.getResponse === 'function');
}
function httpExceptionResponse(err, c) {
    const built = err.res;
    if (built)
        return built;
    const status = err.status;
    if (status >= 500) {
        // Same rule as everything else here: 5xx bodies are generic. A message
        // thrown from a route can name an upstream host just as easily as one
        // raised by a module client can.
        return c.json(errorBody('INTERNAL', GENERIC_INTERNAL), status);
    }
    const fallback = HTTP_EXCEPTION_ERRORS[status];
    const message = err.message.trim() || fallback?.message || 'Request failed.';
    return c.json(errorBody(fallback?.code ?? 'ERROR', scrubMessage(message)), status);
}
/** Shared `app.onError` handler — see module doc for the mapping rules. */
function honoErrorHandler(err, c) {
    // First, ahead of the message-shape sniffing below: a route that threw an
    // HTTPException has already said what it means, and guessing from its
    // text could only overrule it.
    if (isHttpException(err))
        return httpExceptionResponse(err, c);
    if (err instanceof errors_1.XenitionError) {
        const status = statusForCode(err.code);
        const message = status < 500 ? scrubMessage(err.message) : GENERIC_UPSTREAM;
        return c.json(errorBody(err.code, message), status);
    }
    if (err instanceof NotConfiguredError) {
        // Operator-facing and secret-free by construction: it names which env
        // vars to set, never their values.
        return c.json(errorBody('NOT_CONFIGURED', err.message), 501);
    }
    if (err instanceof client_1.XenitionApiConfigError) {
        // Operator-facing and contains no secrets by construction.
        return c.json(errorBody('CONFIG_ERROR', err.message), 500);
    }
    if (err instanceof Error && SDK_VALIDATION_RE.test(err.message)) {
        const notFound = SDK_NOT_FOUND_RE.test(err.message);
        return c.json(errorBody(notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', scrubMessage(err.message)), notFound ? 404 : 400);
    }
    return c.json(errorBody('INTERNAL', GENERIC_INTERNAL), 500);
}
/** JSON 404 for unmatched routes (hono's default is text/plain). */
function jsonNotFound(c) {
    return c.json(errorBody('NOT_FOUND', 'Route not found.'), 404);
}
/**
 * A capability this app never configured — e.g. Google purchase secrets in
 * an iOS-only app.
 *
 * Distinct from `XenitionApiConfigError`: that one means a REQUIRED secret
 * is missing and something is broken. This one means an optional platform
 * was simply never set up, which is a legitimate state, so it answers 501
 * Not Implemented rather than a 500 that reads like a fault.
 */
class NotConfiguredError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotConfiguredError';
    }
}
exports.NotConfiguredError = NotConfiguredError;
/** 400 helper for router-level input validation (query params, body shape). */
function badRequest(c, message) {
    return c.json(errorBody('VALIDATION_ERROR', message), 400);
}
/**
 * 401 — the CALLER did not prove who they are (missing/invalid/expired
 * end-user token).
 *
 * Deliberately not routed through `statusForCode`: an `AUTH_*`
 * XenitionError reaching the shared handler means the worker's OWN service
 * key was rejected, which is a 502 config problem. End-user auth failures
 * are answered here so the two never blur together.
 */
function unauthorized(c, message, code = 'UNAUTHORIZED') {
    return c.json(errorBody(code, message), 401);
}
/** 403 — the caller is known, but not allowed to do this. */
function forbidden(c, message, code = 'FORBIDDEN') {
    return c.json(errorBody(code, message), 403);
}
/**
 * Build the body without sending it — for the callers that need it inside
 * something else, e.g. attaching it to a thrown exception rather than
 * returning it:
 *
 *   throw new HTTPException(402, {
 *     res: Response.json(paymentRequiredBody({ entitlement: 'premium' }), { status: 402 }),
 *   });
 *
 * `honoErrorHandler` passes an exception's own `res` through untouched, so
 * that arrives at the client exactly as built.
 */
function paymentRequiredBody(options) {
    const { entitlement, quota, check } = options;
    const message = options.message ??
        (quota
            ? `You have used all ${quota.limit} of your "${quota.key}" allowance.`
            : `This feature requires "${entitlement}".`);
    return {
        error: { code: 'PAYMENT_REQUIRED', message },
        entitlement,
        ...(quota
            ? {
                quota: {
                    key: quota.key,
                    limit: quota.limit,
                    used: quota.used,
                    resetAt: quota.resetAt,
                },
            }
            : {}),
        ...(check ? { check } : {}),
    };
}
/** 402 — the caller may ask, they just have not paid. Never 403. */
function paymentRequired(c, options) {
    return c.json(paymentRequiredBody(options), 402);
}
//# sourceMappingURL=errors.js.map