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
export { AiClient, AiKeysClient } from './ai';
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

// Constants (exposed for tooling; generated apps don't usually import these)
export { XENITION_BASE_URL } from './constants';
