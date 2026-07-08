import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import {
  fail,
  generateId,
  isPlainObject,
  nowIso,
  optionalNumber,
  optionalPlainObject,
  optionalString,
  requireNonEmptyString,
} from '../util';
import {
  FormField,
  FormFieldType,
  FormRecord,
  FormSubmission,
  ListSubmissionsOptions,
  SubmissionStatus,
} from './types';

export const FORMS_TABLES = {
  FORMS: 'forms__forms',
  SUBMISSIONS: 'forms__submissions',
} as const;

export const FORMS_MIGRATIONS: Migration[] = [
  {
    id: 'forms/0001_create_forms__forms',
    sql: `CREATE TABLE IF NOT EXISTS ${FORMS_TABLES.FORMS} (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'forms/0002_create_forms__submissions',
    sql: `CREATE TABLE IF NOT EXISTS ${FORMS_TABLES.SUBMISSIONS} (
  id uuid PRIMARY KEY,
  form_key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'forms/0003_index_forms__submissions_form_key',
    sql: `CREATE INDEX IF NOT EXISTS forms__submissions_form_key_idx ON ${FORMS_TABLES.SUBMISSIONS} (form_key, created_at)`,
  },
];

const FIELD_TYPES: FormFieldType[] = ['text', 'email', 'number', 'boolean', 'select'];
const SUBMISSION_STATUSES: SubmissionStatus[] = ['new', 'read', 'archived'];

// Deliberately simple: catches typos, not RFC 5322 pathology.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * forms module client — form definitions + validated submissions over
 * `forms__*` tables.
 *
 * Key split (v0 trust model — see modules/core.ts):
 *   - `submit()` works with the ANON key: it reads the form's field schema
 *     and INSERTs one `forms__submissions` row. Validation runs in the SDK
 *     before the insert, so honest clients get precise errors; hostile
 *     clients bypassing the SDK are a server-hardening concern, not v0's.
 *   - `ensureForm()`, `listSubmissions()`, `setStatus()` are back-office
 *     operations — run them with the service key.
 */
export class FormsClient {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * Get-or-create a form by key; updates name/fields when they changed so
   * redeploying an app converges the stored schema. Idempotent.
   */
  async ensureForm(key: string, fields: FormField[], name?: string): Promise<FormRecord> {
    const context = 'FormsClient.ensureForm';
    requireNonEmptyString(context, 'key', key);
    this.validateFieldSchema(context, fields);
    const displayName = optionalString(context, 'name', name, key);

    const existing = await this.getForm(key);
    const now = nowIso();
    if (!existing) {
      const form: FormRecord = {
        id: generateId(),
        key,
        name: displayName,
        fields,
        created_at: now,
        updated_at: now,
      };
      // jsonb *objects* can go over the wire as-is (pg serializes plain
      // objects to JSON), but a JS *array* would be bound as a Postgres
      // array literal — so the fields array is explicitly stringified.
      await this.ctx.query
        .from(FORMS_TABLES.FORMS)
        .insert({ ...form, fields: JSON.stringify(fields) })
        .execute();
      return form;
    }

    const changed =
      existing.name !== displayName ||
      JSON.stringify(existing.fields) !== JSON.stringify(fields);
    if (!changed) return existing;

    await this.ctx.query
      .from(FORMS_TABLES.FORMS)
      .update({ name: displayName, fields: JSON.stringify(fields), updated_at: now })
      .where('key', key)
      .execute();
    return { ...existing, name: displayName, fields, updated_at: now };
  }

  async getForm(key: string): Promise<FormRecord | null> {
    requireNonEmptyString('FormsClient.getForm', 'key', key);
    const row = await this.ctx.query
      .from(FORMS_TABLES.FORMS)
      .where('key', key)
      .first<FormRecord & { fields: FormField[] | string }>();
    if (!row) return null;
    // jsonb usually arrives parsed; tolerate a stringified column.
    const fields = typeof row.fields === 'string' ? (JSON.parse(row.fields) as FormField[]) : row.fields;
    return { ...row, fields };
  }

  /**
   * Validate `data` against the form's stored field schema, then INSERT a
   * `forms__submissions` row (status `new`). Anon-key safe. All schema
   * violations are collected and thrown as one descriptive error.
   */
  async submit(
    key: string,
    data: Record<string, unknown>,
    meta?: Record<string, unknown>,
  ): Promise<FormSubmission> {
    const context = 'FormsClient.submit';
    requireNonEmptyString(context, 'key', key);
    if (!isPlainObject(data)) fail(context, '"data" must be a plain object');

    const form = await this.getForm(key);
    if (!form) fail(context, `unknown form "${key}" — call ensureForm("${key}", fields) first`);

    const errors = this.validateSubmission(form.fields, data);
    if (errors.length > 0) {
      fail(context, `invalid submission for form "${key}": ${errors.join('; ')}`);
    }

    const submission: FormSubmission = {
      id: generateId(),
      form_key: key,
      data,
      meta: optionalPlainObject(context, 'meta', meta, {}),
      status: 'new',
      created_at: nowIso(),
    };
    await this.ctx.query.from(FORMS_TABLES.SUBMISSIONS).insert({ ...submission }).execute();
    return submission;
  }

  /** Back-office listing (service key). Newest first. */
  async listSubmissions(
    key: string,
    options: ListSubmissionsOptions = {},
  ): Promise<FormSubmission[]> {
    const context = 'FormsClient.listSubmissions';
    requireNonEmptyString(context, 'key', key);
    let qb = this.ctx.query.from(FORMS_TABLES.SUBMISSIONS).where('form_key', key);
    if (options.status !== undefined) {
      this.validateStatus(context, options.status);
      qb = qb.where('status', options.status);
    }
    qb = qb.orderBy('created_at', 'DESC');
    if (options.limit !== undefined) qb = qb.limit(optionalNumber(context, 'limit', options.limit, 0));
    if (options.offset !== undefined) qb = qb.offset(optionalNumber(context, 'offset', options.offset, 0));
    return qb.rows<FormSubmission>();
  }

  /** Move a submission through new → read → archived (service key). */
  async setStatus(submissionId: string, status: SubmissionStatus): Promise<void> {
    const context = 'FormsClient.setStatus';
    requireNonEmptyString(context, 'submissionId', submissionId);
    this.validateStatus(context, status);
    await this.ctx.query
      .from(FORMS_TABLES.SUBMISSIONS)
      .update({ status })
      .where('id', submissionId)
      .execute();
  }

  // ───────── internals ─────────

  private validateStatus(context: string, status: unknown): void {
    if (!SUBMISSION_STATUSES.includes(status as SubmissionStatus)) {
      fail(context, `"status" must be one of ${SUBMISSION_STATUSES.join(', ')} — got "${String(status)}"`);
    }
  }

  /** Validates the *schema definition* passed to ensureForm. */
  private validateFieldSchema(context: string, fields: FormField[]): void {
    if (!Array.isArray(fields) || fields.length === 0) {
      fail(context, '"fields" must be a non-empty array of field definitions');
    }
    const seen = new Set<string>();
    for (const field of fields) {
      if (!isPlainObject(field)) fail(context, 'every field definition must be a plain object');
      requireNonEmptyString(context, 'field.name', field.name);
      if (seen.has(field.name)) fail(context, `duplicate field name "${field.name}"`);
      seen.add(field.name);
      if (!FIELD_TYPES.includes(field.type)) {
        fail(
          context,
          `field "${field.name}" has unknown type "${String(field.type)}" (expected ${FIELD_TYPES.join(', ')})`,
        );
      }
      if (field.maxLength !== undefined) {
        if (field.type !== 'text' && field.type !== 'email') {
          fail(context, `field "${field.name}": "maxLength" only applies to text/email fields`);
        }
        if (!Number.isInteger(field.maxLength) || field.maxLength <= 0) {
          fail(context, `field "${field.name}": "maxLength" must be a positive integer`);
        }
      }
      if (field.type === 'select') {
        if (
          !Array.isArray(field.options) ||
          field.options.length === 0 ||
          field.options.some((o) => typeof o !== 'string')
        ) {
          fail(context, `select field "${field.name}" needs a non-empty string "options" array`);
        }
      } else if (field.options !== undefined) {
        fail(context, `field "${field.name}": "options" only applies to select fields`);
      }
    }
  }

  /** Validates a submission's data against the stored schema. */
  private validateSubmission(fields: FormField[], data: Record<string, unknown>): string[] {
    const errors: string[] = [];
    const known = new Set(fields.map((f) => f.name));

    for (const key of Object.keys(data)) {
      if (!known.has(key)) errors.push(`unexpected field "${key}"`);
    }

    for (const field of fields) {
      const value = data[field.name];
      const missing = value === undefined || value === null || value === '';
      if (missing) {
        if (field.required) errors.push(`missing required field "${field.name}"`);
        continue;
      }
      switch (field.type) {
        case 'text':
          if (typeof value !== 'string') {
            errors.push(`field "${field.name}" must be a string`);
          } else if (field.maxLength !== undefined && value.length > field.maxLength) {
            errors.push(`field "${field.name}" exceeds maxLength ${field.maxLength}`);
          }
          break;
        case 'email':
          if (typeof value !== 'string' || !EMAIL_RE.test(value)) {
            errors.push(`field "${field.name}" must be a valid email address`);
          } else if (field.maxLength !== undefined && value.length > field.maxLength) {
            errors.push(`field "${field.name}" exceeds maxLength ${field.maxLength}`);
          }
          break;
        case 'number':
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(`field "${field.name}" must be a finite number`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`field "${field.name}" must be a boolean`);
          }
          break;
        case 'select':
          if (typeof value !== 'string' || !(field.options ?? []).includes(value)) {
            errors.push(
              `field "${field.name}" must be one of: ${(field.options ?? []).join(', ')}`,
            );
          }
          break;
      }
    }
    return errors;
  }
}

/** The forms module definition — wire it up via `client.modules.enable('forms')`. */
export const formsModule = defineModule({
  name: 'forms',
  migrations: FORMS_MIGRATIONS,
  factory: (ctx: ModuleContext) => new FormsClient(ctx),
});
