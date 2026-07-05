import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  CreateRoomInput,
  GenerateTokenInput,
  RecordingStatus,
  VideoRoom,
  VideoTokenResult,
} from './types';

/**
 * LiveKit room + token management. Matches fluxez's
 * `client.videoConferencing.*` surface. Rooms are scoped per-app on the
 * backend; the SDK passes the short name.
 */
export class VideoConferencingClient {
  constructor(private readonly http: HttpClient) {}

  createRoom(input: CreateRoomInput): Promise<VideoRoom> {
    return this.http.post<VideoRoom>(API_ENDPOINTS.VIDEO.ROOMS, input);
  }

  listRooms(): Promise<VideoRoom[]> {
    return this.http.get<VideoRoom[]>(API_ENDPOINTS.VIDEO.ROOMS);
  }

  async endRoom(name: string): Promise<void> {
    await this.http.del<void>(API_ENDPOINTS.VIDEO.ROOM(name));
  }

  generateToken(
    roomName: string,
    identity: string,
    options: Omit<GenerateTokenInput, 'identity'> = {},
  ): Promise<VideoTokenResult> {
    return this.http.post<VideoTokenResult>(
      API_ENDPOINTS.VIDEO.ROOM_TOKEN(roomName),
      { identity, ...options },
    );
  }

  downloadRecording(egressId: string): Promise<RecordingStatus> {
    return this.http.get<RecordingStatus>(API_ENDPOINTS.VIDEO.RECORDING(egressId));
  }
}
