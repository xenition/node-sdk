"use strict";
/**
 * Browser entry point — loaders for the floating chatbot widget and the
 * cookieless analytics tracker. Both are bundled separately (see
 * `tsconfig.browser.json`) so they bundle cleanly into Vite + React
 * apps without pulling in Node-only dependencies like `axios` or
 * `form-data`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadChatbot = void 0;
var chatbot_loader_1 = require("./chatbot-loader");
Object.defineProperty(exports, "loadChatbot", { enumerable: true, get: function () { return chatbot_loader_1.loadChatbot; } });
//# sourceMappingURL=index.js.map