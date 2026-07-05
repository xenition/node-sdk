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

// Errors
export {
  XenitionError,
  isAuthError,
  isNotFound,
  isRateLimited,
} from './core/errors';
export type { XenitionErrorCode } from './core/errors';

// Constants (exposed for tooling; generated apps don't usually import these)
export { XENITION_BASE_URL } from './constants';
