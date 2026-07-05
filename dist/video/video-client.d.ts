import { HttpClient } from '../core/http-client';
import { CreateRoomInput, GenerateTokenInput, RecordingStatus, VideoRoom, VideoTokenResult } from './types';
/**
 * LiveKit room + token management. Matches fluxez's
 * `client.videoConferencing.*` surface. Rooms are scoped per-app on the
 * backend; the SDK passes the short name.
 */
export declare class VideoConferencingClient {
    private readonly http;
    constructor(http: HttpClient);
    createRoom(input: CreateRoomInput): Promise<VideoRoom>;
    listRooms(): Promise<VideoRoom[]>;
    endRoom(name: string): Promise<void>;
    generateToken(roomName: string, identity: string, options?: Omit<GenerateTokenInput, 'identity'>): Promise<VideoTokenResult>;
    downloadRecording(egressId: string): Promise<RecordingStatus>;
}
//# sourceMappingURL=video-client.d.ts.map