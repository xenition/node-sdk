"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CMS_TABLES = exports.CMS_MIGRATIONS = exports.cmsModule = exports.CmsClient = exports.ModulesClient = exports.defineModule = exports.USAGE = exports.DEFAULT_OUTPUT_PATH = exports.CLI_NAME = exports.JSON_TYPE_DECLARATION = exports.JSON_TYPE_NAME = exports.PG_TYPE_MAP = exports.DEFAULT_SCHEMA = exports.INTROSPECTION_SQL = exports.parseArgs = exports.runCodegenCli = exports.readRowField = exports.quoteIdentifier = exports.mapPgType = exports.emitDatabaseTypes = exports.introspectSchema = exports.MIN_USABLE_LIFETIME_MS = exports.MIN_REFRESH_DELAY_MS = exports.DEFAULT_REFRESH_MARGIN_MS = exports.SessionManager = exports.DEFAULT_SESSION_KEY = exports.isStoredSession = exports.toExpiryMs = exports.toStoredSession = exports.createKeyValueSessionStore = exports.MemorySessionStore = exports.MIGRATIONS_LEDGER_TABLE = exports.MigrationsClient = exports.RealtimeClient = exports.VideoConferencingClient = exports.PaymentClient = exports.SearchClient = exports.VectorClient = exports.ChatbotClient = exports.parseSseStream = exports.parseJsonReply = exports.AiKeysClient = exports.AiClient = exports.PushClient = exports.EmailClient = exports.StorageClient = exports.QueryClient = exports.QueryBuilder = exports.AuthClient = exports.XenitionClient = void 0;
exports.jobsModule = exports.JobsClient = exports.handleGoogleNotification = exports.handleAppleNotification = exports.GoogleStore = exports.AppleStore = exports.BILLING_TABLES = exports.BILLING_MIGRATIONS = exports.billingModule = exports.BillingClient = exports.ORDERS_TABLES = exports.ORDERS_MIGRATIONS = exports.ordersModule = exports.OrdersClient = exports.CART_TABLES = exports.CART_MIGRATIONS = exports.cartModule = exports.CartClient = exports.INVENTORY_TABLES = exports.INVENTORY_MIGRATIONS = exports.inventoryModule = exports.InventoryClient = exports.CATALOG_TABLES = exports.CATALOG_MIGRATIONS = exports.catalogModule = exports.CatalogClient = exports.BOOKING_TABLES = exports.BOOKING_MIGRATIONS = exports.bookingModule = exports.BookingClient = exports.MEDIA_TABLES = exports.MEDIA_MIGRATIONS = exports.mediaModule = exports.MediaClient = exports.EVENTS_TABLES = exports.EVENTS_MIGRATIONS = exports.eventsModule = exports.EventsClient = exports.LISTINGS_TABLE = exports.LISTINGS_MIGRATIONS = exports.listingsModule = exports.ListingsClient = exports.REVIEWS_TABLE = exports.REVIEWS_MIGRATIONS = exports.reviewsModule = exports.ReviewsClient = exports.FORMS_TABLES = exports.FORMS_MIGRATIONS = exports.formsModule = exports.FormsClient = void 0;
exports.XENITION_BASE_URL = exports.toBlob = exports.byteLengthOf = exports.buildMultipart = exports.basename = exports.CIRCUIT_COOL_OFF_MS = exports.CIRCUIT_FAILURE_THRESHOLD = exports.MAX_RETRY_WAIT_MS = exports.isCancelledError = exports.REQUEST_ID_HEADER = exports.IDEMPOTENCY_HEADER = exports.XENITION_ERROR_CODES = exports.isXenitionErrorCode = exports.isRateLimited = exports.isNotFound = exports.isAuthError = exports.XenitionError = exports.snakeCaseQueryClient = exports.snakeRows = exports.snakeRow = exports.snakeKey = exports.periodStartFor = exports.periodEndFor = exports.QUOTAS_TABLE = exports.QUOTAS_MIGRATIONS = exports.quotasModule = exports.QuotasClient = exports.NOTIFICATIONS_TABLES = exports.NOTIFICATIONS_MIGRATIONS = exports.notificationsModule = exports.NotificationsClient = exports.JOBS_TABLE = exports.JOBS_MIGRATIONS = void 0;
var xenition_client_1 = require("./xenition-client");
Object.defineProperty(exports, "XenitionClient", { enumerable: true, get: function () { return xenition_client_1.XenitionClient; } });
// Auth module
var auth_client_1 = require("./auth/auth-client");
Object.defineProperty(exports, "AuthClient", { enumerable: true, get: function () { return auth_client_1.AuthClient; } });
// Query module
var query_1 = require("./query");
Object.defineProperty(exports, "QueryBuilder", { enumerable: true, get: function () { return query_1.QueryBuilder; } });
Object.defineProperty(exports, "QueryClient", { enumerable: true, get: function () { return query_1.QueryClient; } });
// Storage module
var storage_1 = require("./storage");
Object.defineProperty(exports, "StorageClient", { enumerable: true, get: function () { return storage_1.StorageClient; } });
// Email module
var email_1 = require("./email");
Object.defineProperty(exports, "EmailClient", { enumerable: true, get: function () { return email_1.EmailClient; } });
// Push module
var push_1 = require("./push");
Object.defineProperty(exports, "PushClient", { enumerable: true, get: function () { return push_1.PushClient; } });
// AI module
var ai_1 = require("./ai");
Object.defineProperty(exports, "AiClient", { enumerable: true, get: function () { return ai_1.AiClient; } });
Object.defineProperty(exports, "AiKeysClient", { enumerable: true, get: function () { return ai_1.AiKeysClient; } });
Object.defineProperty(exports, "parseJsonReply", { enumerable: true, get: function () { return ai_1.parseJsonReply; } });
Object.defineProperty(exports, "parseSseStream", { enumerable: true, get: function () { return ai_1.parseSseStream; } });
// Chatbot module
var chatbot_1 = require("./chatbot");
Object.defineProperty(exports, "ChatbotClient", { enumerable: true, get: function () { return chatbot_1.ChatbotClient; } });
// Vector module
var vector_1 = require("./vector");
Object.defineProperty(exports, "VectorClient", { enumerable: true, get: function () { return vector_1.VectorClient; } });
// Search module
var search_1 = require("./search");
Object.defineProperty(exports, "SearchClient", { enumerable: true, get: function () { return search_1.SearchClient; } });
// Payment module
var payment_1 = require("./payment");
Object.defineProperty(exports, "PaymentClient", { enumerable: true, get: function () { return payment_1.PaymentClient; } });
// Video conferencing module
var video_1 = require("./video");
Object.defineProperty(exports, "VideoConferencingClient", { enumerable: true, get: function () { return video_1.VideoConferencingClient; } });
// Realtime module
var realtime_1 = require("./realtime");
Object.defineProperty(exports, "RealtimeClient", { enumerable: true, get: function () { return realtime_1.RealtimeClient; } });
// Migrations (content-addressed per-app ledger)
var migrations_1 = require("./migrations");
Object.defineProperty(exports, "MigrationsClient", { enumerable: true, get: function () { return migrations_1.MigrationsClient; } });
Object.defineProperty(exports, "MIGRATIONS_LEDGER_TABLE", { enumerable: true, get: function () { return migrations_1.MIGRATIONS_LEDGER_TABLE; } });
// Session lifecycle. The store is an interface with an in-memory default on
// purpose: the caller supplies the platform binding (AsyncStorage,
// expo-secure-store, localStorage), so no React Native or browser import
// enters an SDK that also has to run in a Worker.
var session_store_1 = require("./auth/session-store");
Object.defineProperty(exports, "MemorySessionStore", { enumerable: true, get: function () { return session_store_1.MemorySessionStore; } });
Object.defineProperty(exports, "createKeyValueSessionStore", { enumerable: true, get: function () { return session_store_1.createKeyValueSessionStore; } });
Object.defineProperty(exports, "toStoredSession", { enumerable: true, get: function () { return session_store_1.toStoredSession; } });
Object.defineProperty(exports, "toExpiryMs", { enumerable: true, get: function () { return session_store_1.toExpiryMs; } });
Object.defineProperty(exports, "isStoredSession", { enumerable: true, get: function () { return session_store_1.isStoredSession; } });
Object.defineProperty(exports, "DEFAULT_SESSION_KEY", { enumerable: true, get: function () { return session_store_1.DEFAULT_SESSION_KEY; } });
var session_manager_1 = require("./auth/session-manager");
Object.defineProperty(exports, "SessionManager", { enumerable: true, get: function () { return session_manager_1.SessionManager; } });
Object.defineProperty(exports, "DEFAULT_REFRESH_MARGIN_MS", { enumerable: true, get: function () { return session_manager_1.DEFAULT_REFRESH_MARGIN_MS; } });
Object.defineProperty(exports, "MIN_REFRESH_DELAY_MS", { enumerable: true, get: function () { return session_manager_1.MIN_REFRESH_DELAY_MS; } });
Object.defineProperty(exports, "MIN_USABLE_LIFETIME_MS", { enumerable: true, get: function () { return session_manager_1.MIN_USABLE_LIFETIME_MS; } });
// Schema codegen. Imported for its own sake by tooling only — `cli.ts`
// reaches XenitionClient and fs through a lazy require, so pulling this in
// costs an app neither axios nor a Node builtin.
var codegen_1 = require("./codegen");
Object.defineProperty(exports, "introspectSchema", { enumerable: true, get: function () { return codegen_1.introspectSchema; } });
Object.defineProperty(exports, "emitDatabaseTypes", { enumerable: true, get: function () { return codegen_1.emitDatabaseTypes; } });
Object.defineProperty(exports, "mapPgType", { enumerable: true, get: function () { return codegen_1.mapPgType; } });
Object.defineProperty(exports, "quoteIdentifier", { enumerable: true, get: function () { return codegen_1.quoteIdentifier; } });
Object.defineProperty(exports, "readRowField", { enumerable: true, get: function () { return codegen_1.readRowField; } });
Object.defineProperty(exports, "runCodegenCli", { enumerable: true, get: function () { return codegen_1.runCodegenCli; } });
Object.defineProperty(exports, "parseArgs", { enumerable: true, get: function () { return codegen_1.parseArgs; } });
Object.defineProperty(exports, "INTROSPECTION_SQL", { enumerable: true, get: function () { return codegen_1.INTROSPECTION_SQL; } });
Object.defineProperty(exports, "DEFAULT_SCHEMA", { enumerable: true, get: function () { return codegen_1.DEFAULT_SCHEMA; } });
Object.defineProperty(exports, "PG_TYPE_MAP", { enumerable: true, get: function () { return codegen_1.PG_TYPE_MAP; } });
Object.defineProperty(exports, "JSON_TYPE_NAME", { enumerable: true, get: function () { return codegen_1.JSON_TYPE_NAME; } });
Object.defineProperty(exports, "JSON_TYPE_DECLARATION", { enumerable: true, get: function () { return codegen_1.JSON_TYPE_DECLARATION; } });
Object.defineProperty(exports, "CLI_NAME", { enumerable: true, get: function () { return codegen_1.CLI_NAME; } });
Object.defineProperty(exports, "DEFAULT_OUTPUT_PATH", { enumerable: true, get: function () { return codegen_1.DEFAULT_OUTPUT_PATH; } });
Object.defineProperty(exports, "USAGE", { enumerable: true, get: function () { return codegen_1.USAGE; } });
// Module framework (content modules v0)
var modules_1 = require("./modules");
Object.defineProperty(exports, "defineModule", { enumerable: true, get: function () { return modules_1.defineModule; } });
Object.defineProperty(exports, "ModulesClient", { enumerable: true, get: function () { return modules_1.ModulesClient; } });
// cms module
var cms_1 = require("./modules/cms");
Object.defineProperty(exports, "CmsClient", { enumerable: true, get: function () { return cms_1.CmsClient; } });
Object.defineProperty(exports, "cmsModule", { enumerable: true, get: function () { return cms_1.cmsModule; } });
Object.defineProperty(exports, "CMS_MIGRATIONS", { enumerable: true, get: function () { return cms_1.CMS_MIGRATIONS; } });
Object.defineProperty(exports, "CMS_TABLES", { enumerable: true, get: function () { return cms_1.CMS_TABLES; } });
// forms module
var forms_1 = require("./modules/forms");
Object.defineProperty(exports, "FormsClient", { enumerable: true, get: function () { return forms_1.FormsClient; } });
Object.defineProperty(exports, "formsModule", { enumerable: true, get: function () { return forms_1.formsModule; } });
Object.defineProperty(exports, "FORMS_MIGRATIONS", { enumerable: true, get: function () { return forms_1.FORMS_MIGRATIONS; } });
Object.defineProperty(exports, "FORMS_TABLES", { enumerable: true, get: function () { return forms_1.FORMS_TABLES; } });
// reviews module
var reviews_1 = require("./modules/reviews");
Object.defineProperty(exports, "ReviewsClient", { enumerable: true, get: function () { return reviews_1.ReviewsClient; } });
Object.defineProperty(exports, "reviewsModule", { enumerable: true, get: function () { return reviews_1.reviewsModule; } });
Object.defineProperty(exports, "REVIEWS_MIGRATIONS", { enumerable: true, get: function () { return reviews_1.REVIEWS_MIGRATIONS; } });
Object.defineProperty(exports, "REVIEWS_TABLE", { enumerable: true, get: function () { return reviews_1.REVIEWS_TABLE; } });
// listings module
var listings_1 = require("./modules/listings");
Object.defineProperty(exports, "ListingsClient", { enumerable: true, get: function () { return listings_1.ListingsClient; } });
Object.defineProperty(exports, "listingsModule", { enumerable: true, get: function () { return listings_1.listingsModule; } });
Object.defineProperty(exports, "LISTINGS_MIGRATIONS", { enumerable: true, get: function () { return listings_1.LISTINGS_MIGRATIONS; } });
Object.defineProperty(exports, "LISTINGS_TABLE", { enumerable: true, get: function () { return listings_1.LISTINGS_TABLE; } });
// events module
var events_1 = require("./modules/events");
Object.defineProperty(exports, "EventsClient", { enumerable: true, get: function () { return events_1.EventsClient; } });
Object.defineProperty(exports, "eventsModule", { enumerable: true, get: function () { return events_1.eventsModule; } });
Object.defineProperty(exports, "EVENTS_MIGRATIONS", { enumerable: true, get: function () { return events_1.EVENTS_MIGRATIONS; } });
Object.defineProperty(exports, "EVENTS_TABLES", { enumerable: true, get: function () { return events_1.EVENTS_TABLES; } });
// media module
var media_1 = require("./modules/media");
Object.defineProperty(exports, "MediaClient", { enumerable: true, get: function () { return media_1.MediaClient; } });
Object.defineProperty(exports, "mediaModule", { enumerable: true, get: function () { return media_1.mediaModule; } });
Object.defineProperty(exports, "MEDIA_MIGRATIONS", { enumerable: true, get: function () { return media_1.MEDIA_MIGRATIONS; } });
Object.defineProperty(exports, "MEDIA_TABLES", { enumerable: true, get: function () { return media_1.MEDIA_TABLES; } });
// booking module
var booking_1 = require("./modules/booking");
Object.defineProperty(exports, "BookingClient", { enumerable: true, get: function () { return booking_1.BookingClient; } });
Object.defineProperty(exports, "bookingModule", { enumerable: true, get: function () { return booking_1.bookingModule; } });
Object.defineProperty(exports, "BOOKING_MIGRATIONS", { enumerable: true, get: function () { return booking_1.BOOKING_MIGRATIONS; } });
Object.defineProperty(exports, "BOOKING_TABLES", { enumerable: true, get: function () { return booking_1.BOOKING_TABLES; } });
// catalog module
var catalog_1 = require("./modules/catalog");
Object.defineProperty(exports, "CatalogClient", { enumerable: true, get: function () { return catalog_1.CatalogClient; } });
Object.defineProperty(exports, "catalogModule", { enumerable: true, get: function () { return catalog_1.catalogModule; } });
Object.defineProperty(exports, "CATALOG_MIGRATIONS", { enumerable: true, get: function () { return catalog_1.CATALOG_MIGRATIONS; } });
Object.defineProperty(exports, "CATALOG_TABLES", { enumerable: true, get: function () { return catalog_1.CATALOG_TABLES; } });
// inventory module
var inventory_1 = require("./modules/inventory");
Object.defineProperty(exports, "InventoryClient", { enumerable: true, get: function () { return inventory_1.InventoryClient; } });
Object.defineProperty(exports, "inventoryModule", { enumerable: true, get: function () { return inventory_1.inventoryModule; } });
Object.defineProperty(exports, "INVENTORY_MIGRATIONS", { enumerable: true, get: function () { return inventory_1.INVENTORY_MIGRATIONS; } });
Object.defineProperty(exports, "INVENTORY_TABLES", { enumerable: true, get: function () { return inventory_1.INVENTORY_TABLES; } });
// cart module
var cart_1 = require("./modules/cart");
Object.defineProperty(exports, "CartClient", { enumerable: true, get: function () { return cart_1.CartClient; } });
Object.defineProperty(exports, "cartModule", { enumerable: true, get: function () { return cart_1.cartModule; } });
Object.defineProperty(exports, "CART_MIGRATIONS", { enumerable: true, get: function () { return cart_1.CART_MIGRATIONS; } });
Object.defineProperty(exports, "CART_TABLES", { enumerable: true, get: function () { return cart_1.CART_TABLES; } });
// orders module
var orders_1 = require("./modules/orders");
Object.defineProperty(exports, "OrdersClient", { enumerable: true, get: function () { return orders_1.OrdersClient; } });
Object.defineProperty(exports, "ordersModule", { enumerable: true, get: function () { return orders_1.ordersModule; } });
Object.defineProperty(exports, "ORDERS_MIGRATIONS", { enumerable: true, get: function () { return orders_1.ORDERS_MIGRATIONS; } });
Object.defineProperty(exports, "ORDERS_TABLES", { enumerable: true, get: function () { return orders_1.ORDERS_TABLES; } });
// billing module (in-app purchases + entitlements)
var billing_1 = require("./modules/billing");
Object.defineProperty(exports, "BillingClient", { enumerable: true, get: function () { return billing_1.BillingClient; } });
Object.defineProperty(exports, "billingModule", { enumerable: true, get: function () { return billing_1.billingModule; } });
Object.defineProperty(exports, "BILLING_MIGRATIONS", { enumerable: true, get: function () { return billing_1.BILLING_MIGRATIONS; } });
Object.defineProperty(exports, "BILLING_TABLES", { enumerable: true, get: function () { return billing_1.BILLING_TABLES; } });
Object.defineProperty(exports, "AppleStore", { enumerable: true, get: function () { return billing_1.AppleStore; } });
Object.defineProperty(exports, "GoogleStore", { enumerable: true, get: function () { return billing_1.GoogleStore; } });
Object.defineProperty(exports, "handleAppleNotification", { enumerable: true, get: function () { return billing_1.handleAppleNotification; } });
Object.defineProperty(exports, "handleGoogleNotification", { enumerable: true, get: function () { return billing_1.handleGoogleNotification; } });
// jobs module (deferred + background work)
var jobs_1 = require("./modules/jobs");
Object.defineProperty(exports, "JobsClient", { enumerable: true, get: function () { return jobs_1.JobsClient; } });
Object.defineProperty(exports, "jobsModule", { enumerable: true, get: function () { return jobs_1.jobsModule; } });
Object.defineProperty(exports, "JOBS_MIGRATIONS", { enumerable: true, get: function () { return jobs_1.JOBS_MIGRATIONS; } });
Object.defineProperty(exports, "JOBS_TABLE", { enumerable: true, get: function () { return jobs_1.JOBS_TABLE; } });
// notifications module (inbox, preferences, quiet hours, scheduling)
var notifications_1 = require("./modules/notifications");
Object.defineProperty(exports, "NotificationsClient", { enumerable: true, get: function () { return notifications_1.NotificationsClient; } });
Object.defineProperty(exports, "notificationsModule", { enumerable: true, get: function () { return notifications_1.notificationsModule; } });
Object.defineProperty(exports, "NOTIFICATIONS_MIGRATIONS", { enumerable: true, get: function () { return notifications_1.NOTIFICATIONS_MIGRATIONS; } });
Object.defineProperty(exports, "NOTIFICATIONS_TABLES", { enumerable: true, get: function () { return notifications_1.NOTIFICATIONS_TABLES; } });
// quotas module (durable freemium counters)
var quotas_1 = require("./modules/quotas");
Object.defineProperty(exports, "QuotasClient", { enumerable: true, get: function () { return quotas_1.QuotasClient; } });
Object.defineProperty(exports, "quotasModule", { enumerable: true, get: function () { return quotas_1.quotasModule; } });
Object.defineProperty(exports, "QUOTAS_MIGRATIONS", { enumerable: true, get: function () { return quotas_1.QUOTAS_MIGRATIONS; } });
Object.defineProperty(exports, "QUOTAS_TABLE", { enumerable: true, get: function () { return quotas_1.QUOTAS_TABLE; } });
Object.defineProperty(exports, "periodEndFor", { enumerable: true, get: function () { return quotas_1.periodEndFor; } });
Object.defineProperty(exports, "periodStartFor", { enumerable: true, get: function () { return quotas_1.periodStartFor; } });
// Row casing — the gateway camelCases rows, the engine does not. Apps that
// read snake_case off a row need this at their own query seam too.
var row_casing_1 = require("./modules/row-casing");
Object.defineProperty(exports, "snakeKey", { enumerable: true, get: function () { return row_casing_1.snakeKey; } });
Object.defineProperty(exports, "snakeRow", { enumerable: true, get: function () { return row_casing_1.snakeRow; } });
Object.defineProperty(exports, "snakeRows", { enumerable: true, get: function () { return row_casing_1.snakeRows; } });
Object.defineProperty(exports, "snakeCaseQueryClient", { enumerable: true, get: function () { return row_casing_1.snakeCaseQueryClient; } });
// Errors
var errors_1 = require("./core/errors");
Object.defineProperty(exports, "XenitionError", { enumerable: true, get: function () { return errors_1.XenitionError; } });
Object.defineProperty(exports, "isAuthError", { enumerable: true, get: function () { return errors_1.isAuthError; } });
Object.defineProperty(exports, "isNotFound", { enumerable: true, get: function () { return errors_1.isNotFound; } });
Object.defineProperty(exports, "isRateLimited", { enumerable: true, get: function () { return errors_1.isRateLimited; } });
Object.defineProperty(exports, "isXenitionErrorCode", { enumerable: true, get: function () { return errors_1.isXenitionErrorCode; } });
Object.defineProperty(exports, "XENITION_ERROR_CODES", { enumerable: true, get: function () { return errors_1.XENITION_ERROR_CODES; } });
// HTTP layer (observability hooks, idempotency, request correlation)
var http_client_1 = require("./core/http-client");
Object.defineProperty(exports, "IDEMPOTENCY_HEADER", { enumerable: true, get: function () { return http_client_1.IDEMPOTENCY_HEADER; } });
Object.defineProperty(exports, "REQUEST_ID_HEADER", { enumerable: true, get: function () { return http_client_1.REQUEST_ID_HEADER; } });
// Without this a caller cannot tell "the user navigated away" from "the
// request failed", which is the one failure a UI should say nothing about.
// The predicate is what the doc comment tells people to depend on, and it
// was unreachable: `exports` publishes no subpath that reaches this file.
Object.defineProperty(exports, "isCancelledError", { enumerable: true, get: function () { return http_client_1.isCancelledError; } });
Object.defineProperty(exports, "MAX_RETRY_WAIT_MS", { enumerable: true, get: function () { return http_client_1.MAX_RETRY_WAIT_MS; } });
Object.defineProperty(exports, "CIRCUIT_FAILURE_THRESHOLD", { enumerable: true, get: function () { return http_client_1.CIRCUIT_FAILURE_THRESHOLD; } });
Object.defineProperty(exports, "CIRCUIT_COOL_OFF_MS", { enumerable: true, get: function () { return http_client_1.CIRCUIT_COOL_OFF_MS; } });
// Multipart helpers (Workers-native uploads)
var multipart_1 = require("./core/multipart");
Object.defineProperty(exports, "basename", { enumerable: true, get: function () { return multipart_1.basename; } });
Object.defineProperty(exports, "buildMultipart", { enumerable: true, get: function () { return multipart_1.buildMultipart; } });
Object.defineProperty(exports, "byteLengthOf", { enumerable: true, get: function () { return multipart_1.byteLengthOf; } });
Object.defineProperty(exports, "toBlob", { enumerable: true, get: function () { return multipart_1.toBlob; } });
// Constants (exposed for tooling; generated apps don't usually import these)
var constants_1 = require("./constants");
Object.defineProperty(exports, "XENITION_BASE_URL", { enumerable: true, get: function () { return constants_1.XENITION_BASE_URL; } });
//# sourceMappingURL=index.js.map