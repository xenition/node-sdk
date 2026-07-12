import { XenitionError } from '../../core/errors';
import { Migration } from '../../migrations/types';
import { CATALOG_TABLES } from '../catalog';
import { defineModule, ModuleContext } from '../core';
import { fail, generateId, nowIso, requireNonEmptyString, toNumber } from '../util';
import { CartItem, CartItemView, CartRecord, CartStatus, CartView } from './types';

export const CART_TABLES = {
  CARTS: 'cart__carts',
  ITEMS: 'cart__items',
} as const;

export const CART_MIGRATIONS: Migration[] = [
  {
    id: 'cart/0001_create_cart__carts',
    sql: `CREATE TABLE IF NOT EXISTS ${CART_TABLES.CARTS} (
  id uuid PRIMARY KEY,
  token text NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'cart/0002_create_cart__items',
    sql: `CREATE TABLE IF NOT EXISTS ${CART_TABLES.ITEMS} (
  id uuid PRIMARY KEY,
  cart_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL,
  title text,
  variant_title text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'cart/0003_index_cart__items_cart',
    sql: `CREATE INDEX IF NOT EXISTS cart__items_cart_idx ON ${CART_TABLES.ITEMS} (cart_id)`,
  },
];

/**
 * cart module client — a client-token-keyed shopping cart over
 * `cart__carts` / `cart__items`.
 *
 * A cart is addressed by an opaque, client-generated `token` (kept in the
 * storefront's local storage); there is no auth, so the token itself is the
 * capability. `addItem` snapshots the variant's price + titles from
 * `catalog__variants` (and its product's title from `catalog__products`) at
 * the moment it's added, so a later catalog edit never mutates an open cart,
 * and merges quantity when the same variant is added twice.
 *
 * Money is ALWAYS integer minor units (cents): `unit_price_cents` is a
 * whole-number column, and the subtotal is `Σ unit_price_cents × quantity`.
 *
 * v0 trust model (see modules/core.ts): validation lives in the SDK. Inserts
 * omit `created_at` (a `DEFAULT now()` column) and any unset nullable column.
 */
export class CartClient {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * Fetch the cart for `token`, creating an empty `open` cart if none exists
   * yet. Idempotent under a race: a concurrent create loses the UNIQUE(token)
   * insert and we re-read the winner's row.
   */
  async getOrCreate(token: string): Promise<CartRecord> {
    const context = 'CartClient.getOrCreate';
    requireNonEmptyString(context, 'token', token);
    const existing = await this.findCart(token);
    if (existing) return existing;

    const cart: CartRecord = {
      id: generateId(),
      token,
      currency: 'USD',
      status: 'open',
      created_at: nowIso(),
    };
    // created_at is OWNED by the column default (now()) — omit it from the
    // wire insert (same as every other module).
    const { created_at: _omitted, ...row } = cart;
    try {
      await this.ctx.query.from(CART_TABLES.CARTS).insert(row).execute();
    } catch (err) {
      // Lost the UNIQUE(token) race — the row exists now; re-read it.
      if (this.isConflict(err)) {
        const found = await this.findCart(token);
        if (found) return found;
      }
      throw err;
    }
    return cart;
  }

  /**
   * Add `qty` of a variant to the cart (creating the cart if needed). Looks
   * up the variant in `catalog__variants` to snapshot `unit_price_cents`,
   * `variant_title`, `image_url` + the owning product's title, then MERGES
   * into an existing line for the same variant (quantities add; the original
   * price snapshot is kept). Returns the stored/updated line.
   */
  async addItem(token: string, variantId: string, qty: number): Promise<CartItem> {
    const context = 'CartClient.addItem';
    requireNonEmptyString(context, 'token', token);
    requireNonEmptyString(context, 'variantId', variantId);
    const quantity = this.validateQty(context, 'quantity', qty, 1);
    const cart = await this.getOrCreate(token);

    const variant = await this.ctx.query
      .from(CATALOG_TABLES.VARIANTS)
      .where('id', variantId)
      .first<Record<string, unknown>>();
    if (!variant) fail(context, `variant "${variantId}" not found`);
    const unitPriceCents = toNumber(variant.price_cents ?? variant.priceCents);
    if (unitPriceCents === null) fail(context, `variant "${variantId}" has no price`);
    const variantTitle = this.optText(variant.title);
    const imageUrl = this.optText(variant.image_url ?? variant.imageUrl);
    const productId = this.optText(variant.product_id ?? variant.productId);

    let productTitle: string | null = null;
    if (productId) {
      const product = await this.ctx.query
        .from(CATALOG_TABLES.PRODUCTS)
        .where('id', productId)
        .first<Record<string, unknown>>();
      productTitle = product ? this.optText(product.title) : null;
    }

    // Merge into an existing line for this variant if present.
    const existing = await this.ctx.query
      .from(CART_TABLES.ITEMS)
      .where('cart_id', cart.id)
      .where('variant_id', variantId)
      .first<Record<string, unknown>>();
    if (existing) {
      const merged = (toNumber(existing.quantity) ?? 0) + quantity;
      await this.ctx.query
        .from(CART_TABLES.ITEMS)
        .update({ quantity: merged })
        .where('id', existing.id)
        .execute();
      return {
        id: String(existing.id ?? ''),
        cart_id: cart.id,
        variant_id: variantId,
        quantity: merged,
        // Keep the ORIGINAL price snapshot from when the line was created.
        unit_price_cents: toNumber(existing.unit_price_cents ?? existing.unitPriceCents) ?? unitPriceCents,
        title: this.optText(existing.title),
        variant_title: this.optText(existing.variant_title ?? existing.variantTitle),
        image_url: this.optText(existing.image_url ?? existing.imageUrl),
        created_at: String(existing.created_at ?? existing.createdAt ?? nowIso()),
      };
    }

    const item: CartItem = {
      id: generateId(),
      cart_id: cart.id,
      variant_id: variantId,
      quantity,
      unit_price_cents: unitPriceCents,
      title: productTitle,
      variant_title: variantTitle,
      image_url: imageUrl,
      created_at: nowIso(),
    };
    await this.ctx.query.from(CART_TABLES.ITEMS).insert(this.itemRow(item)).execute();
    return item;
  }

  /**
   * Set a line's quantity. `qty === 0` REMOVES the line. The item is scoped
   * to the cart (`id` + `cart_id`) so a token can only touch its own lines.
   */
  async updateItem(token: string, itemId: string, qty: number): Promise<void> {
    const context = 'CartClient.updateItem';
    requireNonEmptyString(context, 'token', token);
    requireNonEmptyString(context, 'itemId', itemId);
    const quantity = this.validateQty(context, 'quantity', qty, 0);
    const cart = await this.findCart(token);
    if (!cart) fail(context, `unknown cart "${token}"`);
    if (quantity === 0) {
      await this.deleteItem(cart.id, itemId);
      return;
    }
    await this.ctx.query
      .from(CART_TABLES.ITEMS)
      .update({ quantity })
      .where('id', itemId)
      .where('cart_id', cart.id)
      .execute();
  }

  /** Remove a line from the cart. Scoped to the cart. */
  async removeItem(token: string, itemId: string): Promise<void> {
    const context = 'CartClient.removeItem';
    requireNonEmptyString(context, 'token', token);
    requireNonEmptyString(context, 'itemId', itemId);
    const cart = await this.findCart(token);
    if (!cart) fail(context, `unknown cart "${token}"`);
    await this.deleteItem(cart.id, itemId);
  }

  /**
   * The computed cart view: `{ token, currency, items, subtotalCents }` with
   * items camelCased and each carrying a `lineTotalCents`. An unknown token
   * reads as an empty `open` cart (never null) — storefront-friendly.
   */
  async getCart(token: string): Promise<CartView> {
    const context = 'CartClient.getCart';
    requireNonEmptyString(context, 'token', token);
    const cart = await this.findCart(token);
    if (!cart) return { token, currency: 'USD', items: [], subtotalCents: 0 };
    const rows = await this.ctx.query
      .from(CART_TABLES.ITEMS)
      .where('cart_id', cart.id)
      .orderBy('created_at', 'ASC')
      .rows<Record<string, unknown>>();
    const items = rows.map((r) => this.itemView(r));
    const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    return { token, currency: cart.currency, items, subtotalCents };
  }

  /** Empty the cart (delete all its lines). The cart row itself stays. */
  async clear(token: string): Promise<void> {
    const context = 'CartClient.clear';
    requireNonEmptyString(context, 'token', token);
    const cart = await this.findCart(token);
    if (!cart) return;
    await this.ctx.query.from(CART_TABLES.ITEMS).delete().where('cart_id', cart.id).execute();
  }

  /** Flip the cart to 'converted' (called once its order is paid). */
  async markConverted(token: string): Promise<void> {
    const context = 'CartClient.markConverted';
    requireNonEmptyString(context, 'token', token);
    await this.ctx.query
      .from(CART_TABLES.CARTS)
      .update({ status: 'converted' })
      .where('token', token)
      .execute();
  }

  // ───────── internals ─────────

  private async findCart(token: string): Promise<CartRecord | null> {
    const row = await this.ctx.query
      .from(CART_TABLES.CARTS)
      .where('token', token)
      .first<Record<string, unknown>>();
    return row ? this.hydrateCart(row) : null;
  }

  private async deleteItem(cartId: string, itemId: string): Promise<void> {
    await this.ctx.query
      .from(CART_TABLES.ITEMS)
      .delete()
      .where('id', itemId)
      .where('cart_id', cartId)
      .execute();
  }

  /** Wire insert for a line: drop created_at + unset nullable columns. */
  private itemRow(item: CartItem): Record<string, unknown> {
    const { created_at: _omitted, title, variant_title, image_url, ...rest } = item;
    const row: Record<string, unknown> = { ...rest };
    if (title !== null) row.title = title;
    if (variant_title !== null) row.variant_title = variant_title;
    if (image_url !== null) row.image_url = image_url;
    return row;
  }

  /** Row → computed view. Reads snake_case OR camelCase keys (runtimes differ). */
  private itemView(row: Record<string, unknown>): CartItemView {
    const quantity = toNumber(row.quantity) ?? 0;
    const unitPriceCents = toNumber(row.unit_price_cents ?? row.unitPriceCents) ?? 0;
    return {
      id: String(row.id ?? ''),
      variantId: String(row.variant_id ?? row.variantId ?? ''),
      quantity,
      unitPriceCents,
      title: this.optText(row.title),
      variantTitle: this.optText(row.variant_title ?? row.variantTitle),
      imageUrl: this.optText(row.image_url ?? row.imageUrl),
      lineTotalCents: unitPriceCents * quantity,
    };
  }

  private hydrateCart(row: Record<string, unknown>): CartRecord {
    return {
      id: String(row.id ?? ''),
      token: String(row.token ?? ''),
      currency: String(row.currency ?? 'USD'),
      status: (row.status === 'converted' ? 'converted' : 'open') as CartStatus,
      created_at: String(row.created_at ?? row.createdAt ?? ''),
    };
  }

  private optText(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
  }

  /** Integer quantity >= `min` (0 allowed only where a line-remove is valid). */
  private validateQty(context: string, field: string, value: unknown, min: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      fail(context, `"${field}" must be an integer >= ${min} — got "${String(value)}"`);
    }
    return value;
  }

  private isConflict(err: unknown): boolean {
    if (err instanceof XenitionError && err.code === 'CONFLICT') return true;
    return err instanceof Error && /duplicate|unique|conflict/i.test(err.message);
  }
}

/** The cart module definition — wire it up via `client.modules.enable('cart')`. */
export const cartModule = defineModule({
  name: 'cart',
  migrations: CART_MIGRATIONS,
  factory: (ctx: ModuleContext) => new CartClient(ctx),
});
