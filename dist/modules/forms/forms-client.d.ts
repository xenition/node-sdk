import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { FormField, FormRecord, FormSubmission, ListSubmissionsOptions, SubmissionStatus } from './types';
export declare const FORMS_TABLES: {
    readonly FORMS: "forms__forms";
    readonly SUBMISSIONS: "forms__submissions";
};
export declare const FORMS_MIGRATIONS: Migration[];
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
export declare class FormsClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Get-or-create a form by key; updates name/fields when they changed so
     * redeploying an app converges the stored schema. Idempotent.
     */
    ensureForm(key: string, fields: FormField[], name?: string): Promise<FormRecord>;
    getForm(key: string): Promise<FormRecord | null>;
    /**
     * Validate `data` against the form's stored field schema, then INSERT a
     * `forms__submissions` row (status `new`). Anon-key safe. All schema
     * violations are collected and thrown as one descriptive error.
     */
    submit(key: string, data: Record<string, unknown>, meta?: Record<string, unknown>): Promise<FormSubmission>;
    /** Back-office listing (service key). Newest first. */
    listSubmissions(key: string, options?: ListSubmissionsOptions): Promise<FormSubmission[]>;
    /** Move a submission through new → read → archived (service key). */
    setStatus(submissionId: string, status: SubmissionStatus): Promise<void>;
    private validateStatus;
    /** Validates the *schema definition* passed to ensureForm. */
    private validateFieldSchema;
    /** Validates a submission's data against the stored schema. */
    private validateSubmission;
}
/** The forms module definition — wire it up via `client.modules.enable('forms')`. */
export declare const formsModule: import("../core").ModuleDefinition<FormsClient>;
//# sourceMappingURL=forms-client.d.ts.map