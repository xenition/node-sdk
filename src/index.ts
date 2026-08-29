export { XenitionClient } from './xenition-client';
export type { XenitionClientOptions } from './xenition-client';

// Auth module
export { AuthClient } from './auth/auth-client';
export type {
  User,
  Session,
  AuthToken,
  AuthResponse,
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  ListUsersOptions,
  SearchUsersOptions,
  PagedResult,
  OAuthProvider,
  OAuthUrlResult,
  Team,
  TeamInvitationInput,
  ResetPasswordInput,
  ChangePasswordInput,
  DeleteAccountInput,
  DeleteAccountResult,
  IdTokenSignInInput,
  OtpChannel,
  OtpPurpose,
  SendOtpInput,
  SendOtpResult,
  UserDataExport,
  VerifyOtpInput,
} from './auth/types';

// Query module
export { QueryBuilder, QueryClient } from './query';
export type {
  QueryPayload,
  QueryResult,
  QueryType,
  WhereCondition,
  WhereOperator,
  JoinClause,
  JoinType,
  OrderByClause,
  OrderDirection,
} from './query';

// Storage module
export { StorageClient } from './storage';
export type {
  UploadOptions,
  UploadResult,
  StorageFile,
  SignedUrlResult,
  SignedUrlOptions,
  ListFilesOptions,
  ListFilesResult,
} from './storage';

// Email module
export { EmailClient } from './email';
export type { SendEmailOptions, SendEmailResult, SendBulkResult } from './email';

// Push module
export { PushClient } from './push';
export type {
  PushPlatform,
  PushDevice,
  PushNotification,
  PushTarget,
  RegisterDeviceInput,
  SendPushInput,
  SendPushResult,
} from './push';

// AI module
export { AiClient, AiKeysClient, parseJsonReply, parseSseStream } from './ai';
export type {
  AiProvider,
  AiUsage,
  ChatMessage,
  GenerateTextOutput,
  ChatOutput,
  GenerateImageOutput,
  GenerateVideoOutput,
  GenerateEmbeddingsOutput,
  AiKeyRecord,
  GenerateTextOptions,
  ChatOptions,
  GenerateImageOptions,
  GenerateVideoOptions,
  GenerateEmbeddingsOptions,
  CreateAiKeyInput,
  UpdateAiKeyInput,
  ChatDelta,
  ResponseFormat,
  SpeechFormat,
  SpeechOptions,
  SpeechOutput,
  TranscribeOptions,
  TranscribeOutput,
  TranscribedWord,
} from './ai';

// Chatbot module
export { ChatbotClient } from './chatbot';
export type {
  ChatbotConfig,
  ChatbotConfigPatch,
  ChatbotDocument,
  ChatbotMessage,
  SendMessageInput,
  SendMessageResult,
  UploadDocumentOptions,
} from './chatbot';

// Vector module
export { VectorClient } from './vector';
export type {
  VectorDocument,
  VectorSearchResult,
  VectorCollectionInfo,
  VectorDistance,
  CreateCollectionInput,
  SearchOptions,
} from './vector';

// Search module
export { SearchClient } from './search';
export type {
  SearchConfig,
  SearchMode,
  SearchHit,
  UnifiedSearchResult,
  UnifiedSearchOptions,
  ConfigureSearchInput,
} from './search';

// Payment module
export { PaymentClient } from './payment';
export type {
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentConfig,
  PaymentConfigPatch,
  StripeInvoice,
  StripeSubscription,
} from './payment';

// Video conferencing module
export { VideoConferencingClient } from './video';
export type {
  VideoRoom,
  CreateRoomInput,
  GenerateTokenInput,
  VideoTokenResult,
  RecordingStatus,
} from './video';

// Realtime module
export { RealtimeClient } from './realtime';
export type { RealtimeMessage, RealtimeHandler, Subscription } from './realtime';

// Migrations (content-addressed per-app ledger)
export { MigrationsClient, MIGRATIONS_LEDGER_TABLE } from './migrations';
export type { Migration, MigrationLedgerRow, ApplyResult } from './migrations';

// Session lifecycle. The store is an interface with an in-memory default on
// purpose: the caller supplies the platform binding (AsyncStorage,
// expo-secure-store, localStorage), so no React Native or browser import
// enters an SDK that also has to run in a Worker.
export {
  MemorySessionStore,
  createKeyValueSessionStore,
  toStoredSession,
  toExpiryMs,
  isStoredSession,
  DEFAULT_SESSION_KEY,
} from './auth/session-store';
export type { SessionStore, StoredSession, KeyValueStorage } from './auth/session-store';
export {
  SessionManager,
  DEFAULT_REFRESH_MARGIN_MS,
  MIN_REFRESH_DELAY_MS,
  MIN_USABLE_LIFETIME_MS,
} from './auth/session-manager';
export type {
  SessionManagerOptions,
  AuthChangeEvent,
  AuthStateListener,
} from './auth/session-manager';

// Schema codegen. Imported for its own sake by tooling only — `cli.ts`
// reaches XenitionClient and fs through a lazy require, so pulling this in
// costs an app neither axios nor a Node builtin.
export {
  introspectSchema,
  emitDatabaseTypes,
  mapPgType,
  quoteIdentifier,
  readRowField,
  runCodegenCli,
  parseArgs,
  INTROSPECTION_SQL,
  DEFAULT_SCHEMA,
  PG_TYPE_MAP,
  JSON_TYPE_NAME,
  JSON_TYPE_DECLARATION,
  CLI_NAME,
  DEFAULT_OUTPUT_PATH,
  USAGE,
} from './codegen';
export type {
  IntrospectOptions,
  EmitOptions,
  MappedType,
  ColumnInfo,
  TableInfo,
  IntrospectedSchema,
  RawCapableClient,
  RawResult,
  CodegenCliDeps,
  CodegenRunResult,
} from './codegen';

// Module framework (content modules v0)
export { defineModule, ModulesClient } from './modules';
export type { ModuleContext, ModuleDefinition, ModuleName } from './modules';

// cms module
export { CmsClient, cmsModule, CMS_MIGRATIONS, CMS_TABLES } from './modules/cms';
export type {
  CmsPage,
  CreatePageInput,
  UpdatePageInput,
  CmsCollection,
  CmsItem,
  CreateItemInput,
  UpdateItemInput,
  CmsListOptions,
} from './modules/cms';

// forms module
export { FormsClient, formsModule, FORMS_MIGRATIONS, FORMS_TABLES } from './modules/forms';
export type {
  FormField,
  FormFieldType,
  FormRecord,
  FormSubmission,
  SubmissionStatus,
  ListSubmissionsOptions,
} from './modules/forms';

// reviews module
export {
  ReviewsClient,
  reviewsModule,
  REVIEWS_MIGRATIONS,
  REVIEWS_TABLE,
} from './modules/reviews';
export type {
  Review,
  ReviewStatus,
  ReviewTarget,
  SubmitReviewInput,
  ReviewAggregate,
  ListReviewsOptions,
} from './modules/reviews';

// listings module
export {
  ListingsClient,
  listingsModule,
  LISTINGS_MIGRATIONS,
  LISTINGS_TABLE,
} from './modules/listings';
export type {
  Listing,
  ListingStatus,
  CreateListingInput,
  ListListingsOptions,
  GetBySlugOptions,
  SearchListingsOptions,
} from './modules/listings';

// events module
export {
  EventsClient,
  eventsModule,
  EVENTS_MIGRATIONS,
  EVENTS_TABLES,
} from './modules/events';
export type {
  EventRecord,
  EventStatus,
  EventWhen,
  EventWithCounts,
  EventCounts,
  CreateEventInput,
  ListEventsOptions,
  Rsvp,
  RsvpStatus,
  RsvpInput,
  ListRsvpsOptions,
} from './modules/events';

// media module
export {
  MediaClient,
  mediaModule,
  MEDIA_MIGRATIONS,
  MEDIA_TABLES,
} from './modules/media';
export type {
  MediaKind,
  MediaAlbum,
  CreateAlbumInput,
  UpdateAlbumInput,
  MediaItem,
  // Aliased to avoid colliding with the cms module's item input types.
  AddItemInput as AddMediaItemInput,
  UpdateItemInput as UpdateMediaItemInput,
  MediaAlbumWithItems,
  ListAlbumsOptions,
  ListItemsOptions,
} from './modules/media';

// booking module
export {
  BookingClient,
  bookingModule,
  BOOKING_MIGRATIONS,
  BOOKING_TABLES,
} from './modules/booking';
export type {
  BookingResource,
  ResourceStatus,
  AvailabilityRule,
  CreateResourceInput,
  UpdateResourceInput,
  ListResourcesOptions,
  Blackout,
  AddBlackoutInput,
  Booking,
  BookingStatus,
  BookInput,
  SearchSlotsOptions,
  Slot,
  ListBookingsOptions,
} from './modules/booking';

// catalog module
export {
  CatalogClient,
  catalogModule,
  CATALOG_MIGRATIONS,
  CATALOG_TABLES,
} from './modules/catalog';
export type {
  ProductStatus,
  CatalogCollection,
  // Aliased to avoid colliding with the vector module's collection input type.
  CreateCollectionInput as CreateCatalogCollectionInput,
  CatalogProduct,
  CatalogVariant,
  ProductWithVariants,
  CreateProductInput,
  CreateVariantInput,
  UpdateProductInput,
  UpdateVariantInput,
  ListProductsOptions,
  GetProductOptions,
} from './modules/catalog';

// inventory module
export {
  InventoryClient,
  inventoryModule,
  INVENTORY_MIGRATIONS,
  INVENTORY_TABLES,
} from './modules/inventory';
export type {
  StockPolicy,
  StockRow,
  StockView,
  SetStockOptions,
} from './modules/inventory';

// cart module
export { CartClient, cartModule, CART_MIGRATIONS, CART_TABLES } from './modules/cart';
export type {
  CartStatus,
  CartRecord,
  CartItem,
  CartItemView,
  CartView,
} from './modules/cart';

// orders module
export { OrdersClient, ordersModule, ORDERS_MIGRATIONS, ORDERS_TABLES } from './modules/orders';
export type {
  OrderStatus,
  OrderRecord,
  OrderItem,
  OrderWithItems,
  CreateOrderInput,
  MarkPaidInput,
  ListOrdersOptions,
} from './modules/orders';

// billing module (in-app purchases + entitlements)
export {
  BillingClient,
  billingModule,
  BILLING_MIGRATIONS,
  BILLING_TABLES,
  AppleStore,
  GoogleStore,
  handleAppleNotification,
  handleGoogleNotification,
} from './modules/billing';
export type {
  AppleConfig,
  AppleTransaction,
  GoogleConfig,
  NotificationResult,
} from './modules/billing';
export type {
  BillingEvent,
  BillingPlatform,
  BillingProduct,
  DefineProductInput,
  Entitlement,
  EntitlementCheck,
  EntitlementSource,
  EntitlementStatus,
  GrantInput,
  ProductKind,
  Purchase,
  PurchaseStatus,
  RecordPurchaseInput,
  StartTrialInput,
  // Aliased — the catalog module already exports a list-products option type.
  ListProductsOptions as ListBillingProductsOptions,
  ListPurchasesOptions,
} from './modules/billing';

// jobs module (deferred + background work)
export { JobsClient, jobsModule, JOBS_MIGRATIONS, JOBS_TABLE } from './modules/jobs';
export type {
  ClaimOptions,
  EnqueueOptions,
  FailOptions,
  Job,
  JobContext,
  JobHandler,
  JobStatus,
  WorkSummary,
  ListJobsOptions as ListJobsQueryOptions,
} from './modules/jobs';

// notifications module (inbox, preferences, quiet hours, scheduling)
export {
  NotificationsClient,
  notificationsModule,
  NOTIFICATIONS_MIGRATIONS,
  NOTIFICATIONS_TABLES,
} from './modules/notifications';
export type {
  ListNotificationsResult,
  NotificationChannel,
  NotificationPreference,
  NotificationRecord,
  NotifyInput,
  NotifyResult,
  PreferencePatch,
  ScheduleInput,
  ScheduledNotification,
  ScheduledStatus,
  ListNotificationsOptions as ListInboxOptions,
} from './modules/notifications';

// quotas module (durable freemium counters)
export {
  QuotasClient,
  quotasModule,
  QUOTAS_MIGRATIONS,
  QUOTAS_TABLE,
  periodEndFor,
  periodStartFor,
} from './modules/quotas';
export type { QuotaPeriod, QuotaState, ConsumeOptions as ConsumeQuotaOptions } from './modules/quotas';

// Row casing — the gateway camelCases rows, the engine does not. Apps that
// read snake_case off a row need this at their own query seam too.
export { snakeKey, snakeRow, snakeRows, snakeCaseQueryClient } from './modules/row-casing';

// Errors
export {
  XenitionError,
  isAuthError,
  isNotFound,
  isRateLimited,
  isXenitionErrorCode,
  XENITION_ERROR_CODES,
} from './core/errors';
export type { XenitionErrorCode } from './core/errors';

// HTTP layer (observability hooks, idempotency, request correlation)
export {
  IDEMPOTENCY_HEADER,
  REQUEST_ID_HEADER,
  // Without this a caller cannot tell "the user navigated away" from "the
  // request failed", which is the one failure a UI should say nothing about.
  // The predicate is what the doc comment tells people to depend on, and it
  // was unreachable: `exports` publishes no subpath that reaches this file.
  isCancelledError,
  MAX_RETRY_WAIT_MS,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOL_OFF_MS,
} from './core/http-client';
export type { CircuitBreakerOptions } from './core/http-client';
export type {
  HttpClientOptions,
  RequestErrorEvent,
  RequestEvent,
  RequestOptions,
  ResponseEvent,
} from './core/http-client';

// Multipart helpers (Workers-native uploads)
export { basename, buildMultipart, byteLengthOf, toBlob } from './core/multipart';
export type { UploadBody } from './core/multipart';

// Constants (exposed for tooling; generated apps don't usually import these)
export { XENITION_BASE_URL } from './constants';
