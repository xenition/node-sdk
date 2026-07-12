"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDate = exports.AppClientError = exports.createAppClient = void 0;
/**
 * `@xenition/sdk/client` — the browser/worker data layer for generated apps.
 *
 * A framework-agnostic, key-less client for a template's OWN backend (which
 * mounts the `@xenition/sdk/hono` routers). Zero node builtins, zero axios,
 * global `fetch` only — safe to bundle into any frontend. Unlike `./hono`
 * (node-only), this subpath IS browser-safe and ships in both builds.
 *
 * The exported TYPES are the single source of truth for the API shapes
 * templates consume — they mirror the router normalization (camelCase) so a
 * template's data layer collapses to imports from this one module.
 */
var app_client_1 = require("./app-client");
Object.defineProperty(exports, "createAppClient", { enumerable: true, get: function () { return app_client_1.createAppClient; } });
var errors_1 = require("./errors");
Object.defineProperty(exports, "AppClientError", { enumerable: true, get: function () { return errors_1.AppClientError; } });
var format_1 = require("./format");
Object.defineProperty(exports, "formatDate", { enumerable: true, get: function () { return format_1.formatDate; } });
//# sourceMappingURL=index.js.map