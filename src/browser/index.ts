/**
 * Browser entry point — loaders for the floating chatbot widget and the
 * cookieless analytics tracker. Both are bundled separately (see
 * `tsconfig.browser.json`) so they bundle cleanly into Vite + React
 * apps without pulling in Node-only dependencies like `axios` or
 * `form-data`.
 */

export { loadChatbot } from './chatbot-loader';
export type { LoadChatbotOptions } from './chatbot-loader';
