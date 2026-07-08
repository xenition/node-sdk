/**
 * cms module types. Row shapes mirror the `cms__*` tables 1:1 (snake_case
 * column names are the wire contract with `/app-platform/query`).
 */

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  body_html: string;
  seo: Record<string, unknown>;
  published: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePageInput {
  title: string;
  /** Omit to auto-generate from the title (kebab-case, `-2` deduping). */
  slug?: string;
  body_html?: string;
  seo?: Record<string, unknown>;
  published?: boolean;
  sort?: number;
}

export interface UpdatePageInput {
  title?: string;
  slug?: string;
  body_html?: string;
  seo?: Record<string, unknown>;
  published?: boolean;
  sort?: number;
}

export interface CmsCollection {
  id: string;
  key: string;
  name: string;
}

export interface CmsItem {
  id: string;
  collection_id: string;
  slug: string;
  title: string;
  data: Record<string, unknown>;
  published: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface CreateItemInput {
  title: string;
  /** Omit to auto-generate from the title (deduped within the collection). */
  slug?: string;
  data?: Record<string, unknown>;
  published?: boolean;
  sort?: number;
}

export interface UpdateItemInput {
  title?: string;
  slug?: string;
  data?: Record<string, unknown>;
  published?: boolean;
  sort?: number;
}

export interface CmsListOptions {
  /** Filter on the published flag; omit for all rows. */
  published?: boolean;
  /** Column to order by (whitelisted per entity); defaults to `sort`. */
  orderBy?: string;
  direction?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}
