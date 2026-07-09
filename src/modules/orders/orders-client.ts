import { XenitionError } from '../../core/errors';
import { Migration } from '../../migrations/types';
import { CART_TABLES } from '../cart';
import { defineModule, ModuleContext } from '../core';
import { InventoryClient } from '../inventory';
import { fail, generateId, nowIso, optionalPlainObject, requireNonEmptyString, toNumber } from '../util';
import {
  CreateOrderInput,
  ListOrdersOptions,
  MarkPaidInput,
  OrderItem,
  OrderRecord,
  OrderStatus,
  OrderWithItems,
} from './types';

export const ORDERS_TABLES = {
  ORDERS: 'orders__orders',
  ITEMS: 'orders__items',
} as const;

export const ORDERS_MIGRATIONS: Migration[] = [
  {
    id: 'orders/0001_create_orders__orders',
    sql: `CREATE TABLE IF NOT EXISTS ${ORDERS_TABLES.ORDERS} (
  id uuid PRIMARY KEY,
  number text NOT NULL UNIQUE,
  cart_token text,
  email text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  subtotal_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  payment_provider text,
  payment_ref text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'orders/0002_index_orders__orders_status',
    sql: `CREATE INDEX IF NOT EXISTS orders__orders_status_idx ON ${ORDERS_TABLES.ORDERS} (status, created_at)`,
  },
  {
    id: 'orders/0003_create_orders__items',
    sql: `CREATE TABLE IF NOT EXISTS ${ORDERS_TABLES.ITEMS} (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  title text,
  variant_title text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL
)`,
  },
  {
    id: 'orders/0004_index_orders__items_order',
    sql: `CREATE INDEX IF NOT EXISTS orders__items_order_idx ON ${ORDERS_TABLES.ITEMS} (order_id)`,
  },
];

const ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'];
/**
 * Statuses that mean the order has ALREADY been through payment — markPaid is
 * a no-op for these, which is the guard against a double inventory commit.
 */
const ALREADY_PROCESSED: OrderStatus[] = ['paid', 'fulfilled', 'refunded'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Human-ish order-number alphabet — no ambiguous 0/O/1/I/L characters. */
const NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const NUMBER_LEN = 6;
const NUMBER_MAX_ATTEMPTS = 8;

/**
 * orders module client — placed orders + their line items over
 * `orders__orders` / `orders__items`.
 *
 * `createFromCart` snapshots a cart's items into an immutable pending order
 * (with a unique human-ish `number`, allocated with retry-on-conflict).
 * `markPaid` is the settlement seam wired to the checkout router (mock and
 * Stripe both land here): it flips the order to `paid`, COMMITS inventory for
 * every line (`inventory.commit(variantId, qty)`), and marks the source cart
 * converted — all idempotently: a re-entry on an already-paid order is a
 * no-op, so inventory is never double-committed.
 *
 * Money is ALWAYS integer minor units (cents). v0 has no tax/shipping, so
 * `total_cents === subtotal_cents`.
 *
 * v0 trust model (see modules/core.ts): validation lives in the SDK. Inserts
 * omit `created_at` (a `DEFAULT now()` column) and any unset nullable column.
 */
export class OrdersClient {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * Snapshot an open cart's items into a new `pending` order. Reads the cart
   * (`cart__carts` / `cart__items`) directly, copies each line's snapshotted
   * price/titles, and sets `total_cents = subtotal_cents` (v0 — no tax or
   * shipping). Fails on an unknown or empty cart. Returns the order + items.
   */
  async createFromCart(token: string, input: CreateOrderInput): Promise<OrderWithItems> {
    const context = 'OrdersClient.createFromCart';
    requireNonEmptyString(context, 'token', token);
    const email = this.requireEmail(context, input?.email);
    const data = optionalPlainObject(context, 'data', input?.data, {});

    const cart = await this.ctx.query
      .from(CART_TABLES.CARTS)
      .where('token', token)
      .first<Record<string, unknown>>();
    if (!cart) fail(context, `unknown cart "${token}"`);
    const cartId = String(cart.id ?? '');
    const currency = String(cart.currency ?? 'USD');

    const itemRows = await this.ctx.query
      .from(CART_TABLES.ITEMS)
      .where('cart_id', cartId)
      .orderBy('created_at', 'ASC')
      .rows<Record<string, unknown>>();
    if (itemRows.length === 0) fail(context, `cart "${token}" is empty`);

    const orderId = generateId();
    const items: OrderItem[] = itemRows.map((r) => ({
      id: generateId(),
      order_id: orderId,
      variant_id: String(r.variant_id ?? r.variantId ?? ''),
      title: this.optText(r.title),
      variant_title: this.optText(r.variant_title ?? r.variantTitle),
      quantity: toNumber(r.quantity) ?? 0,
      unit_price_cents: toNumber(r.unit_price_cents ?? r.unitPriceCents) ?? 0,
    }));
    const subtotalCents = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);

    const order = await this.insertWithUniqueNumber(context, {
      id: orderId,
      cart_token: token,
      email,
      currency,
      subtotal_cents: subtotalCents,
      total_cents: subtotalCents, // v0: no tax/shipping.
      data,
    });

    await this.ctx.query
      .from(ORDERS_TABLES.ITEMS)
      .insert(items.map((i) => this.itemRow(i)))
      .execute();
    return { ...order, items };
  }

  /** Fetch an order + its items by id. Null if unknown. */
  async get(id: string): Promise<OrderWithItems | null> {
    const context = 'OrdersClient.get';
    requireNonEmptyString(context, 'id', id);
    const row = await this.ctx.query
      .from(ORDERS_TABLES.ORDERS)
      .where('id', id)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return this.withItems(this.hydrateOrder(row));
  }

  /** Fetch an order + its items by its human-ish `number`. Null if unknown. */
  async getByNumber(number: string): Promise<OrderWithItems | null> {
    const context = 'OrdersClient.getByNumber';
    requireNonEmptyString(context, 'number', number);
    const row = await this.ctx.query
      .from(ORDERS_TABLES.ORDERS)
      .where('number', number)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return this.withItems(this.hydrateOrder(row));
  }

  /** List orders (without items), newest first; optionally by status/limit. */
  async list(options: ListOrdersOptions = {}): Promise<OrderRecord[]> {
    const context = 'OrdersClient.list';
    let qb = this.ctx.query.from(ORDERS_TABLES.ORDERS);
    if (options.status !== undefined) {
      if (!ORDER_STATUSES.includes(options.status)) {
        fail(context, `"status" must be one of ${ORDER_STATUSES.join(', ')} — got "${String(options.status)}"`);
      }
      qb = qb.where('status', options.status);
    }
    qb = qb.orderBy('created_at', 'DESC');
    if (options.limit !== undefined) {
      if (typeof options.limit !== 'number' || !Number.isInteger(options.limit) || options.limit < 0) {
        fail(context, `"limit" must be a non-negative integer — got "${String(options.limit)}"`);
      }
      qb = qb.limit(options.limit);
    }
    const rows = await qb.rows<Record<string, unknown>>();
    return rows.map((r) => this.hydrateOrder(r));
  }

  /**
   * Settle an order: flip it to `paid`, COMMIT inventory for every line
   * (`inventory.commit(variantId, qty)`), and mark the source cart converted.
   * IDEMPOTENT: if the order is already paid/fulfilled/refunded this is a
   * no-op and inventory is NOT committed a second time. Returns the order +
   * items in their post-payment state.
   */
  async markPaid(id: string, input: MarkPaidInput): Promise<OrderWithItems> {
    const context = 'OrdersClient.markPaid';
    requireNonEmptyString(context, 'id', id);
    const provider = requireNonEmptyString(context, 'provider', input?.provider);
    const ref = requireNonEmptyString(context, 'ref', input?.ref);

    const current = await this.get(id);
    if (!current) fail(context, `unknown order "${id}"`);
    // Double-commit guard: already-processed orders short-circuit.
    if (ALREADY_PROCESSED.includes(current.status)) return current;

    await this.ctx.query
      .from(ORDERS_TABLES.ORDERS)
      .update({ status: 'paid', payment_provider: provider, payment_ref: ref })
      .where('id', id)
      .execute();

    // Consume stock (and clear the reservation) for each purchased line.
    const inventory = new InventoryClient(this.ctx);
    for (const item of current.items) {
      if (item.variant_id && item.quantity > 0) {
        await inventory.commit(item.variant_id, item.quantity);
      }
    }

    // The cart has done its job — convert it so it can't be re-ordered.
    if (current.cart_token) {
      await this.ctx.query
        .from(CART_TABLES.CARTS)
        .update({ status: 'converted' })
        .where('token', current.cart_token)
        .execute();
    }

    return { ...current, status: 'paid', payment_provider: provider, payment_ref: ref };
  }

  /** Set an order's status to any valid state (service key). */
  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    const context = 'OrdersClient.updateStatus';
    requireNonEmptyString(context, 'id', id);
    if (!ORDER_STATUSES.includes(status)) {
      fail(context, `"status" must be one of ${ORDER_STATUSES.join(', ')} — got "${String(status)}"`);
    }
    await this.ctx.query.from(ORDERS_TABLES.ORDERS).update({ status }).where('id', id).execute();
  }

  // ───────── internals ─────────

  /**
   * Insert the order, allocating a unique `number` with retry-on-conflict:
   * on a UNIQUE(number) collision a fresh number is tried, up to
   * `NUMBER_MAX_ATTEMPTS` times.
   */
  private async insertWithUniqueNumber(
    context: string,
    base: {
      id: string;
      cart_token: string;
      email: string;
      currency: string;
      subtotal_cents: number;
      total_cents: number;
      data: Record<string, unknown>;
    },
  ): Promise<OrderRecord> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < NUMBER_MAX_ATTEMPTS; attempt += 1) {
      const order: OrderRecord = {
        id: base.id,
        number: this.generateNumber(),
        cart_token: base.cart_token,
        email: base.email,
        currency: base.currency,
        subtotal_cents: base.subtotal_cents,
        total_cents: base.total_cents,
        status: 'pending',
        payment_provider: null,
        payment_ref: null,
        data: base.data,
        created_at: nowIso(),
      };
      try {
        await this.ctx.query.from(ORDERS_TABLES.ORDERS).insert(this.orderRow(order)).execute();
        return order;
      } catch (err) {
        if (this.isConflict(err)) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error(`${context}: could not allocate a unique order number`);
  }

  private async withItems(order: OrderRecord): Promise<OrderWithItems> {
    const rows = await this.ctx.query
      .from(ORDERS_TABLES.ITEMS)
      .where('order_id', order.id)
      .rows<Record<string, unknown>>();
    return { ...order, items: rows.map((r) => this.hydrateItem(r)) };
  }

  /** Wire insert for an order: drop created_at + unset nullable columns. */
  private orderRow(order: OrderRecord): Record<string, unknown> {
    const { created_at: _omitted, cart_token, payment_provider, payment_ref, ...rest } = order;
    const row: Record<string, unknown> = { ...rest };
    if (cart_token !== null) row.cart_token = cart_token;
    if (payment_provider !== null) row.payment_provider = payment_provider;
    if (payment_ref !== null) row.payment_ref = payment_ref;
    return row;
  }

  /** Wire insert for a line: drop unset nullable columns (title/variant_title). */
  private itemRow(item: OrderItem): Record<string, unknown> {
    const { title, variant_title, ...rest } = item;
    const row: Record<string, unknown> = { ...rest };
    if (title !== null) row.title = title;
    if (variant_title !== null) row.variant_title = variant_title;
    return row;
  }

  private hydrateOrder(row: Record<string, unknown>): OrderRecord {
    const get = (snake: string, camel: string): unknown => row[snake] ?? row[camel];
    return {
      id: String(get('id', 'id') ?? ''),
      number: String(get('number', 'number') ?? ''),
      cart_token: this.optText(get('cart_token', 'cartToken')),
      email: String(get('email', 'email') ?? ''),
      currency: String(get('currency', 'currency') ?? 'USD'),
      subtotal_cents: toNumber(get('subtotal_cents', 'subtotalCents')) ?? 0,
      total_cents: toNumber(get('total_cents', 'totalCents')) ?? 0,
      status: (ORDER_STATUSES.includes(get('status', 'status') as OrderStatus)
        ? (get('status', 'status') as OrderStatus)
        : 'pending'),
      payment_provider: this.optText(get('payment_provider', 'paymentProvider')),
      payment_ref: this.optText(get('payment_ref', 'paymentRef')),
      data: (this.isPlainObject(get('data', 'data')) ? (get('data', 'data') as Record<string, unknown>) : {}),
      created_at: String(get('created_at', 'createdAt') ?? ''),
    };
  }

  private hydrateItem(row: Record<string, unknown>): OrderItem {
    return {
      id: String(row.id ?? ''),
      order_id: String(row.order_id ?? row.orderId ?? ''),
      variant_id: String(row.variant_id ?? row.variantId ?? ''),
      title: this.optText(row.title),
      variant_title: this.optText(row.variant_title ?? row.variantTitle),
      quantity: toNumber(row.quantity) ?? 0,
      unit_price_cents: toNumber(row.unit_price_cents ?? row.unitPriceCents) ?? 0,
    };
  }

  /** `XN-` + a short random suffix (Math.random/crypto are fine at runtime). */
  private generateNumber(): string {
    const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    let suffix = '';
    if (cryptoObj?.getRandomValues) {
      const buf = cryptoObj.getRandomValues(new Uint8Array(NUMBER_LEN));
      for (let i = 0; i < NUMBER_LEN; i += 1) suffix += NUMBER_ALPHABET[buf[i]! % NUMBER_ALPHABET.length];
    } else {
      for (let i = 0; i < NUMBER_LEN; i += 1) {
        suffix += NUMBER_ALPHABET[Math.floor(Math.random() * NUMBER_ALPHABET.length)];
      }
    }
    return `XN-${suffix}`;
  }

  private optText(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private requireEmail(context: string, value: unknown): string {
    const email = requireNonEmptyString(context, 'email', value);
    if (!EMAIL_RE.test(email)) fail(context, '"email" must be a valid email address');
    return email;
  }

  private isConflict(err: unknown): boolean {
    if (err instanceof XenitionError && err.code === 'CONFLICT') return true;
    return err instanceof Error && /duplicate|unique|conflict/i.test(err.message);
  }
}

/** The orders module definition — wire it up via `client.modules.enable('orders')`. */
export const ordersModule = defineModule({
  name: 'orders',
  migrations: ORDERS_MIGRATIONS,
  factory: (ctx: ModuleContext) => new OrdersClient(ctx),
});
