"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoConferencingClient = void 0;
const constants_1 = require("../constants");
/**
 * LiveKit room + token management. Matches fluxez's
 * `client.videoConferencing.*` surface. Rooms are scoped per-app on the
 * backend; the SDK passes the short name.
 */
class VideoConferencingClient {
    constructor(http) {
        this.http = http;
    }
    createRoom(input) {
        return this.http.post(constants_1.API_ENDPOINTS.VIDEO.ROOMS, input);
    }
    listRooms() {
        return this.http.get(constants_1.API_ENDPOINTS.VIDEO.ROOMS);
    }
    async endRoom(name) {
        await this.http.del(constants_1.API_ENDPOINTS.VIDEO.ROOM(name));
    }
    generateToken(roomName, identity, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.VIDEO.ROOM_TOKEN(roomName), { identity, ...options });
    }
    downloadRecording(egressId) {
        return this.http.get(constants_1.API_ENDPOINTS.VIDEO.RECORDING(egressId));
    }
}
exports.VideoConferencingClient = VideoConferencingClient;
//# sourceMappingURL=video-client.js.map