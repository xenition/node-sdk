export interface VideoRoom {
    name: string;
    sid: string;
    emptyTimeout: number;
    maxParticipants: number;
    creationTime: number;
    numParticipants: number;
    metadata: string;
}
export interface CreateRoomInput {
    name: string;
    emptyTimeout?: number;
    maxParticipants?: number;
    metadata?: string;
}
export interface GenerateTokenInput {
    identity: string;
    name?: string;
    ttl?: number;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
    metadata?: string;
}
export interface VideoTokenResult {
    token: string;
    url: string;
    expiresAt: string;
}
export interface RecordingStatus {
    url: string | null;
    status: string;
}
//# sourceMappingURL=types.d.ts.map