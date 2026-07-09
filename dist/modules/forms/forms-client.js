"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formsModule = exports.FormsClient = exports.FORMS_MIGRATIONS = exports.FORMS_TABLES = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.FORMS_TABLES = {
    FORMS: 'forms__forms',
    SUBMISSIONS: 'forms__submissions',
};
exports.FORMS_MIGRATIONS = [
    {
        id: 'forms/0001_create_forms__forms',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.FORMS_TABLES.FORMS} (
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
        sql: `CREATE TABLE IF NOT EXISTS ${exports.FORMS_TABLES.SUBMISSIONS} (
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
        sql: `CREATE INDEX IF NOT EXISTS forms__submissions_form_key_idx ON ${exports.FORMS_TABLES.SUBMISSIONS} (form_key, created_at)`,
    },
];
const FIELD_TYPES = ['text', 'email', 'number', 'boolean', 'select'];
const SUBMISSION_STATUSES = ['new', 'read', 'archived'];
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
class FormsClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Get-or-create a form by key; updates name/fields when they changed so
     * redeploying an app converges the stored schema. Idempotent.
     */
    async ensureForm(key, fields, name) {
        const context = 'FormsClient.ensureForm';
        (0, util_1.requireNonEmptyString)(context, 'key', key);
        this.validateFieldSchema(context, fields);
        const displayName = (0, util_1.optionalString)(context, 'name', name, key);
        const existing = await this.getForm(key);
        const now = (0, util_1.nowIso)();
        if (!existing) {
            const form = {
                id: (0, util_1.generateId)(),
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
                .from(exports.FORMS_TABLES.FORMS)
                .insert({ ...form, fields: JSON.stringify(fields) })
                .execute();
            return form;
        }
        const changed = existing.name !== displayName ||
            JSON.stringify(existing.fields) !== JSON.stringify(fields);
        if (!changed)
            return existing;
        await this.ctx.query
            .from(exports.FORMS_TABLES.FORMS)
            .update({ name: displayName, fields: JSON.stringify(fields), updated_at: now })
            .where('key', key)
            .execute();
        return { ...existing, name: displayName, fields, updated_at: now };
    }
    async getForm(key) {
        (0, util_1.requireNonEmptyString)('FormsClient.getForm', 'key', key);
        const row = await this.ctx.query
            .from(exports.FORMS_TABLES.FORMS)
            .where('key', key)
            .first();
        if (!row)
            return null;
        // jsonb usually arrives parsed; tolerate a stringified column.
        const fields = typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields;
        return { ...row, fields };
    }
    /**
     * Validate `data` against the form's stored field schema, then INSERT a
     * `forms__submissions` row (status `new`). Anon-key safe. All schema
     * violations are collected and thrown as one descriptive error.
     */
    async submit(key, data, meta) {
        const context = 'FormsClient.submit';
        (0, util_1.requireNonEmptyString)(context, 'key', key);
        if (!(0, util_1.isPlainObject)(data))
            (0, util_1.fail)(context, '"data" must be a plain object');
        const form = await this.getForm(key);
        if (!form)
            (0, util_1.fail)(context, `unknown form "${key}" — call ensureForm("${key}", fields) first`);
        const errors = this.validateSubmission(form.fields, data);
        if (errors.length > 0) {
            (0, util_1.fail)(context, `invalid submission for form "${key}": ${errors.join('; ')}`);
        }
        const submission = {
            id: (0, util_1.generateId)(),
            form_key: key,
            data,
            meta: (0, util_1.optionalPlainObject)(context, 'meta', meta, {}),
            status: 'new',
            created_at: (0, util_1.nowIso)(),
        };
        // created_at is OWNED by the column default (now()): the engine runtime
        // binds parameters natively and rejects ISO *strings* for timestamptz,
        // so the wire insert omits it. The returned object carries the client
        // clock's nowIso() as a close approximation of what the DB stamped.
        const { created_at: _omitted, ...row } = submission;
        await this.ctx.query.from(exports.FORMS_TABLES.SUBMISSIONS).insert(row).execute();
        return submission;
    }
    /** Back-office listing (service key). Newest first. */
    async listSubmissions(key, options = {}) {
        const context = 'FormsClient.listSubmissions';
        (0, util_1.requireNonEmptyString)(context, 'key', key);
        let qb = this.ctx.query.from(exports.FORMS_TABLES.SUBMISSIONS).where('form_key', key);
        if (options.status !== undefined) {
            this.validateStatus(context, options.status);
            qb = qb.where('status', options.status);
        }
        qb = qb.orderBy('created_at', 'DESC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    /** Move a submission through new → read → archived (service key). */
    async setStatus(submissionId, status) {
        const context = 'FormsClient.setStatus';
        (0, util_1.requireNonEmptyString)(context, 'submissionId', submissionId);
        this.validateStatus(context, status);
        await this.ctx.query
            .from(exports.FORMS_TABLES.SUBMISSIONS)
            .update({ status })
            .where('id', submissionId)
            .execute();
    }
    // ───────── internals ─────────
    validateStatus(context, status) {
        if (!SUBMISSION_STATUSES.includes(status)) {
            (0, util_1.fail)(context, `"status" must be one of ${SUBMISSION_STATUSES.join(', ')} — got "${String(status)}"`);
        }
    }
    /** Validates the *schema definition* passed to ensureForm. */
    validateFieldSchema(context, fields) {
        if (!Array.isArray(fields) || fields.length === 0) {
            (0, util_1.fail)(context, '"fields" must be a non-empty array of field definitions');
        }
        const seen = new Set();
        for (const field of fields) {
            if (!(0, util_1.isPlainObject)(field))
                (0, util_1.fail)(context, 'every field definition must be a plain object');
            (0, util_1.requireNonEmptyString)(context, 'field.name', field.name);
            if (seen.has(field.name))
                (0, util_1.fail)(context, `duplicate field name "${field.name}"`);
            seen.add(field.name);
            if (!FIELD_TYPES.includes(field.type)) {
                (0, util_1.fail)(context, `field "${field.name}" has unknown type "${String(field.type)}" (expected ${FIELD_TYPES.join(', ')})`);
            }
            if (field.maxLength !== undefined) {
                if (field.type !== 'text' && field.type !== 'email') {
                    (0, util_1.fail)(context, `field "${field.name}": "maxLength" only applies to text/email fields`);
                }
                if (!Number.isInteger(field.maxLength) || field.maxLength <= 0) {
                    (0, util_1.fail)(context, `field "${field.name}": "maxLength" must be a positive integer`);
                }
            }
            if (field.type === 'select') {
                if (!Array.isArray(field.options) ||
                    field.options.length === 0 ||
                    field.options.some((o) => typeof o !== 'string')) {
                    (0, util_1.fail)(context, `select field "${field.name}" needs a non-empty string "options" array`);
                }
            }
            else if (field.options !== undefined) {
                (0, util_1.fail)(context, `field "${field.name}": "options" only applies to select fields`);
            }
        }
    }
    /** Validates a submission's data against the stored schema. */
    validateSubmission(fields, data) {
        const errors = [];
        const known = new Set(fields.map((f) => f.name));
        for (const key of Object.keys(data)) {
            if (!known.has(key))
                errors.push(`unexpected field "${key}"`);
        }
        for (const field of fields) {
            const value = data[field.name];
            const missing = value === undefined || value === null || value === '';
            if (missing) {
                if (field.required)
                    errors.push(`missing required field "${field.name}"`);
                continue;
            }
            switch (field.type) {
                case 'text':
                    if (typeof value !== 'string') {
                        errors.push(`field "${field.name}" must be a string`);
                    }
                    else if (field.maxLength !== undefined && value.length > field.maxLength) {
                        errors.push(`field "${field.name}" exceeds maxLength ${field.maxLength}`);
                    }
                    break;
                case 'email':
                    if (typeof value !== 'string' || !EMAIL_RE.test(value)) {
                        errors.push(`field "${field.name}" must be a valid email address`);
                    }
                    else if (field.maxLength !== undefined && value.length > field.maxLength) {
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
                        errors.push(`field "${field.name}" must be one of: ${(field.options ?? []).join(', ')}`);
                    }
                    break;
            }
        }
        return errors;
    }
}
exports.FormsClient = FormsClient;
/** The forms module definition — wire it up via `client.modules.enable('forms')`. */
exports.formsModule = (0, core_1.defineModule)({
    name: 'forms',
    migrations: exports.FORMS_MIGRATIONS,
    factory: (ctx) => new FormsClient(ctx),
});
//# sourceMappingURL=forms-client.js.map