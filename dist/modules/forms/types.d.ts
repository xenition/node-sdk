/**
 * forms module types. `FormField[]` is the declarative field schema stored
 * in `forms__forms.fields` and enforced client-side on every `submit()`.
 */
export type FormFieldType = 'text' | 'email' | 'number' | 'boolean' | 'select';
export interface FormField {
    /** Key in the submission's `data` object. */
    name: string;
    type: FormFieldType;
    required?: boolean;
    /** Max string length — text/email fields only. */
    maxLength?: number;
    /** Allowed values — select fields only (required for them). */
    options?: string[];
}
export interface FormRecord {
    id: string;
    key: string;
    name: string;
    fields: FormField[];
    created_at: string;
    updated_at: string;
}
export type SubmissionStatus = 'new' | 'read' | 'archived';
export interface FormSubmission {
    id: string;
    form_key: string;
    data: Record<string, unknown>;
    meta: Record<string, unknown>;
    status: SubmissionStatus;
    created_at: string;
}
export interface ListSubmissionsOptions {
    status?: SubmissionStatus;
    limit?: number;
    offset?: number;
}
//# sourceMappingURL=types.d.ts.map