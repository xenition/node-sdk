import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
export interface NotificationsRouterOptions extends XenitionRouterOptions {
    /**
     * The categories this app actually sends — what a settings screen should
     * show switches for. Defaults to `['general']`, the module's own default
     * category.
     *
     * This exists because of a real asymmetry in the module:
     * `listPreferences` returns only rows that EXIST, and a row is written
     * only when somebody changes something. A fresh account therefore gets
     * `[]` — a settings screen with nothing on it — even though the user very
     * much has effective preferences (in-app and push on, email off).
     * `getPreference` returns those defaults for a category with no row, so
     * `GET /preferences` fills the configured categories in from it rather
     * than inventing defaults of its own. The module stays the single source
     * of truth for what "unset" means, and it stays changeable later.
     */
    categories?: string[];
}
export declare function notificationsRouter(options?: NotificationsRouterOptions): Hono;
//# sourceMappingURL=notifications-router.d.ts.map