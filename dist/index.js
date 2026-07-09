"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG_MIGRATIONS = exports.catalogModule = exports.CatalogClient = exports.BOOKING_TABLES = exports.BOOKING_MIGRATIONS = exports.bookingModule = exports.BookingClient = exports.MEDIA_TABLES = exports.MEDIA_MIGRATIONS = exports.mediaModule = exports.MediaClient = exports.EVENTS_TABLES = exports.EVENTS_MIGRATIONS = exports.eventsModule = exports.EventsClient = exports.LISTINGS_TABLE = exports.LISTINGS_MIGRATIONS = exports.listingsModule = exports.ListingsClient = exports.REVIEWS_TABLE = exports.REVIEWS_MIGRATIONS = exports.reviewsModule = exports.ReviewsClient = exports.FORMS_TABLES = exports.FORMS_MIGRATIONS = exports.formsModule = exports.FormsClient = exports.CMS_TABLES = exports.CMS_MIGRATIONS = exports.cmsModule = exports.CmsClient = exports.ModulesClient = exports.defineModule = exports.MIGRATIONS_LEDGER_TABLE = exports.MigrationsClient = exports.RealtimeClient = exports.VideoConferencingClient = exports.PaymentClient = exports.SearchClient = exports.VectorClient = exports.ChatbotClient = exports.AiKeysClient = exports.AiClient = exports.PushClient = exports.EmailClient = exports.StorageClient = exports.QueryClient = exports.QueryBuilder = exports.AuthClient = exports.XenitionClient = void 0;
exports.XENITION_BASE_URL = exports.XENITION_ERROR_CODES = exports.isXenitionErrorCode = exports.isRateLimited = exports.isNotFound = exports.isAuthError = exports.XenitionError = exports.INVENTORY_TABLES = exports.INVENTORY_MIGRATIONS = exports.inventoryModule = exports.InventoryClient = exports.CATALOG_TABLES = void 0;
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
// Errors
var errors_1 = require("./core/errors");
Object.defineProperty(exports, "XenitionError", { enumerable: true, get: function () { return errors_1.XenitionError; } });
Object.defineProperty(exports, "isAuthError", { enumerable: true, get: function () { return errors_1.isAuthError; } });
Object.defineProperty(exports, "isNotFound", { enumerable: true, get: function () { return errors_1.isNotFound; } });
Object.defineProperty(exports, "isRateLimited", { enumerable: true, get: function () { return errors_1.isRateLimited; } });
Object.defineProperty(exports, "isXenitionErrorCode", { enumerable: true, get: function () { return errors_1.isXenitionErrorCode; } });
Object.defineProperty(exports, "XENITION_ERROR_CODES", { enumerable: true, get: function () { return errors_1.XENITION_ERROR_CODES; } });
// Constants (exposed for tooling; generated apps don't usually import these)
var constants_1 = require("./constants");
Object.defineProperty(exports, "XENITION_BASE_URL", { enumerable: true, get: function () { return constants_1.XENITION_BASE_URL; } });
//# sourceMappingURL=index.js.map