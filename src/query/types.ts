/**
 * Serializable IR for the QueryBuilder → xenition backend hop. The backend
 * translates these payloads to parameterized `pg` SQL against the per-app
 * DB. The IR is the wire contract — keep it in sync with
 * `modules/app-platform-query/` on the server side.
 */

export type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export type WhereOperator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'LIKE'
  | 'ILIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'BETWEEN'
  | 'RAW';

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export type OrderDirection = 'ASC' | 'DESC' | 'asc' | 'desc';

export interface WhereCondition {
  column: string;
  operator: WhereOperator;
  value: unknown;
  type: 'AND' | 'OR';
}

export interface JoinClause {
  type: JoinType;
  table: string;
  firstColumn: string;
  operator: string;
  secondColumn: string;
}

export interface OrderByClause {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface QueryPayload {
  type: QueryType;
  table: string;
  columns?: string[];
  distinct?: boolean;
  where?: WhereCondition[];
  joins?: JoinClause[];
  groupBy?: string[];
  having?: WhereCondition[];
  orderBy?: OrderByClause[];
  limit?: number;
  offset?: number;
  data?: Record<string, unknown> | Record<string, unknown>[];
  returning?: string[];
}

export interface QueryResult<T = unknown> {
  data: T[];
  count?: number;
  metadata?: Record<string, unknown>;
}
