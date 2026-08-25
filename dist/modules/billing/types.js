"use strict";
/**
 * Types for the billing module — mobile in-app purchases and the
 * entitlements they grant.
 *
 * Vocabulary, because the stores disagree with each other:
 *   - PRODUCT      a thing the store sells, addressed by `productId`
 *                  ("com.acme.premium.monthly").
 *   - PURCHASE     one verified transaction chain. Apple identifies it by
 *                  `originalTransactionId`, Google by `purchaseToken`; the
 *                  SDK calls both `originalTransactionId` so a renewal
 *                  updates the row it belongs to instead of creating a new
 *                  one. This is the idempotency key.
 *   - ENTITLEMENT  what the user may DO ("premium"). Products grant it,
 *                  trials grant it, support grants it. The app asks about
 *                  entitlements and never about products.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map