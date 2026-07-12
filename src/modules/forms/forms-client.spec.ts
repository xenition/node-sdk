import { HttpClient } from '../../core/http-client';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { FormsClient, FORMS_TABLES } from './forms-client';
import { FormField } from './types';

const makeForms = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, forms: new FormsClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const CONTACT_FIELDS: FormField[] = [
  { name: 'name', type: 'text', required: true, maxLength: 100 },
  { name: 'email', type: 'email', required: true },
  { name: 'age', type: 'number' },
  { name: 'subscribed', type: 'boolean' },
  { name: 'topic', type: 'select', options: ['sales', 'support'] },
];

const contactForm = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'f1',
  key: 'contact',
  name: 'Contact',
  fields: CONTACT_FIELDS,
  created_at: 't0',
  updated_at: 't0',
  ...overrides,
});

/** First post resolves the form lookup; second the submission insert. */
const primeForm = (post: jest.Mock, form: unknown) => {
  post.mockResolvedValueOnce({ data: form ? [form] : [] }).mockResolvedValueOnce({ data: [] });
};

describe('ensureForm', () => {
  it('creates a missing form (fields stringified for the jsonb column)', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const form = await forms.ensureForm('contact', CONTACT_FIELDS, 'Contact');
    expect(form).toEqual(
      expect.objectContaining({ key: 'contact', name: 'Contact', fields: CONTACT_FIELDS }),
    );
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(FORMS_TABLES.FORMS);
    expect((insert.data as Record<string, unknown>).fields).toBe(JSON.stringify(CONTACT_FIELDS));
  });

  it('is a no-op when the stored schema already matches', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValueOnce({ data: [contactForm()] });
    const form = await forms.ensureForm('contact', CONTACT_FIELDS, 'Contact');
    expect(form.id).toBe('f1');
    expect(post).toHaveBeenCalledTimes(1); // lookup only, no write
  });

  it('updates name/fields when the schema changed', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValueOnce({ data: [contactForm()] }).mockResolvedValueOnce({ data: [] });
    const newFields: FormField[] = [{ name: 'email', type: 'email', required: true }];
    const form = await forms.ensureForm('contact', newFields, 'Contact v2');
    expect(form.fields).toEqual(newFields);
    expect(form.name).toBe('Contact v2');
    const update = payloadOf(post, 1);
    expect(update.type).toBe('UPDATE');
    expect(update.where).toEqual([
      { column: 'key', operator: '=', value: 'contact', type: 'AND' },
    ]);
    expect(update.data).toEqual(
      expect.objectContaining({ name: 'Contact v2', fields: JSON.stringify(newFields) }),
    );
  });

  it('name defaults to the key', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const form = await forms.ensureForm('newsletter', [{ name: 'email', type: 'email' }]);
    expect(form.name).toBe('newsletter');
  });

  it('rejects invalid field schemas with precise errors', async () => {
    const { forms } = makeForms();
    const cases: Array<[FormField[], RegExp]> = [
      [[], /non-empty array/],
      [[{ name: '', type: 'text' }], /"field\.name"/],
      [
        [
          { name: 'a', type: 'text' },
          { name: 'a', type: 'text' },
        ],
        /duplicate field name "a"/,
      ],
      [[{ name: 'a', type: 'photo' as FormField['type'] }], /unknown type "photo"/],
      [[{ name: 'a', type: 'number', maxLength: 5 }], /"maxLength" only applies to text\/email/],
      [[{ name: 'a', type: 'text', maxLength: 0 }], /positive integer/],
      [[{ name: 'a', type: 'select' }], /needs a non-empty string "options" array/],
      [[{ name: 'a', type: 'text', options: ['x'] }], /"options" only applies to select/],
    ];
    for (const [fields, error] of cases) {
      await expect(forms.ensureForm('f', fields)).rejects.toThrow(error);
    }
  });
});

describe('getForm', () => {
  it('parses a stringified jsonb fields column', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValue({ data: [contactForm({ fields: JSON.stringify(CONTACT_FIELDS) })] });
    const form = await forms.getForm('contact');
    expect(form?.fields).toEqual(CONTACT_FIELDS);
  });

  it('resolves null for a missing form', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValue({ data: [] });
    await expect(forms.getForm('nope')).resolves.toBeNull();
  });
});

describe('submit: happy path', () => {
  it('validates against the stored schema and inserts a status=new submission', async () => {
    const { post, forms } = makeForms();
    primeForm(post, contactForm());
    const submission = await forms.submit(
      'contact',
      { name: 'Ada', email: 'ada@example.com', topic: 'sales' },
      { ua: 'jest' },
    );
    expect(submission).toEqual(
      expect.objectContaining({
        form_key: 'contact',
        status: 'new',
        data: { name: 'Ada', email: 'ada@example.com', topic: 'sales' },
        meta: { ua: 'jest' },
      }),
    );
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(FORMS_TABLES.SUBMISSIONS);
    // The wire insert omits created_at — the DB default owns it (the
    // engine runtime rejects ISO strings bound to timestamptz).
    const { created_at: _omitted, ...expectedRow } = submission;
    expect(insert.data).toEqual(expectedRow);
  });

  it('accepts a submission that omits optional fields', async () => {
    const { post, forms } = makeForms();
    primeForm(post, contactForm());
    await expect(
      forms.submit('contact', { name: 'Ada', email: 'ada@example.com' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'new', meta: {} }));
  });

  it('throws for an unknown form key before touching submissions', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValue({ data: [] });
    await expect(forms.submit('ghost', {})).rejects.toThrow(
      /unknown form "ghost" — call ensureForm/,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('submit: validation matrix', () => {
  const submitWith = async (data: Record<string, unknown>) => {
    const { post, forms } = makeForms();
    primeForm(post, contactForm());
    return { post, promise: forms.submit('contact', data) };
  };

  it('rejects a missing required field', async () => {
    const { promise } = await submitWith({ email: 'ada@example.com' });
    await expect(promise).rejects.toThrow(/missing required field "name"/);
  });

  it('treats empty string and null as missing for required fields', async () => {
    const { promise } = await submitWith({ name: '', email: null });
    await expect(promise).rejects.toThrow(/missing required field "name"/);
    const { promise: p2 } = await submitWith({ name: 'Ada', email: '' });
    await expect(p2).rejects.toThrow(/missing required field "email"/);
  });

  it('rejects a malformed email', async () => {
    const { promise } = await submitWith({ name: 'Ada', email: 'not-an-email' });
    await expect(promise).rejects.toThrow(/field "email" must be a valid email address/);
  });

  it('rejects wrong runtime types (number / boolean)', async () => {
    const { promise } = await submitWith({
      name: 'Ada',
      email: 'ada@example.com',
      age: 'forty',
      subscribed: 'yes',
    });
    await expect(promise).rejects.toThrow(/field "age" must be a finite number/);
    await expect(promise).rejects.toThrow(/field "subscribed" must be a boolean/);
  });

  it('rejects a select value outside the options', async () => {
    const { promise } = await submitWith({
      name: 'Ada',
      email: 'ada@example.com',
      topic: 'gossip',
    });
    await expect(promise).rejects.toThrow(/field "topic" must be one of: sales, support/);
  });

  it('enforces maxLength on text fields', async () => {
    const { promise } = await submitWith({
      name: 'x'.repeat(101),
      email: 'ada@example.com',
    });
    await expect(promise).rejects.toThrow(/field "name" exceeds maxLength 100/);
  });

  it('rejects fields not present in the schema', async () => {
    const { promise } = await submitWith({
      name: 'Ada',
      email: 'ada@example.com',
      spam: 'buy now',
    });
    await expect(promise).rejects.toThrow(/unexpected field "spam"/);
  });

  it('aggregates every violation into one descriptive error, and never inserts', async () => {
    const { post, promise } = await submitWith({ email: 'nope', extra: 1 });
    await expect(promise).rejects.toThrow(
      /invalid submission for form "contact".*unexpected field "extra".*missing required field "name".*must be a valid email/s,
    );
    expect(post).toHaveBeenCalledTimes(1); // schema lookup only — no INSERT
  });

  it('rejects non-object data outright', async () => {
    const { forms } = makeForms();
    await expect(
      forms.submit('contact', 'hello' as unknown as Record<string, unknown>),
    ).rejects.toThrow(/"data" must be a plain object/);
  });
});

describe('date fields', () => {
  const bookingForm = {
    id: 'f2',
    key: 'booking',
    name: 'Booking',
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'when', type: 'date', required: true },
    ] as FormField[],
    created_at: 't0',
    updated_at: 't0',
  };

  it('ensureForm accepts a date field in the schema', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    await expect(
      forms.ensureForm('booking', bookingForm.fields, 'Booking'),
    ).resolves.toBeDefined();
  });

  it('accepts a valid ISO date (YYYY-MM-DD)', async () => {
    const { post, forms } = makeForms();
    primeForm(post, bookingForm);
    await expect(forms.submit('booking', { name: 'Ada', when: '2026-07-18' })).resolves.toBeDefined();
  });

  it('rejects a malformed date', async () => {
    const { post, forms } = makeForms();
    primeForm(post, bookingForm);
    await expect(forms.submit('booking', { name: 'Ada', when: '07/18/2026' })).rejects.toThrow(
      /field "when" must be a date \(YYYY-MM-DD\)/,
    );
  });

  it('rejects options on a date field at schema time', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    await expect(
      forms.ensureForm('booking', [{ name: 'when', type: 'date', options: ['x'] }], 'Booking'),
    ).rejects.toThrow(/"options" only applies to select/);
  });
});

describe('back-office: listSubmissions / setStatus', () => {
  it('lists newest-first with a status filter and pagination', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValue({ data: [] });
    await forms.listSubmissions('contact', { status: 'new', limit: 20, offset: 40 });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: FORMS_TABLES.SUBMISSIONS,
        where: [
          { column: 'form_key', operator: '=', value: 'contact', type: 'AND' },
          { column: 'status', operator: '=', value: 'new', type: 'AND' },
        ],
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
        limit: 20,
        offset: 40,
      }),
    );
  });

  it('rejects an invalid status filter', async () => {
    const { forms } = makeForms();
    await expect(
      forms.listSubmissions('contact', { status: 'starred' as never }),
    ).rejects.toThrow(/"status" must be one of new, read, archived/);
  });

  it('setStatus updates the row and validates the status', async () => {
    const { post, forms } = makeForms();
    post.mockResolvedValue({ data: [] });
    await forms.setStatus('s1', 'read');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        type: 'UPDATE',
        table: FORMS_TABLES.SUBMISSIONS,
        data: { status: 'read' },
        where: [{ column: 'id', operator: '=', value: 's1', type: 'AND' }],
      }),
    );
    await expect(forms.setStatus('s1', 'trashed' as never)).rejects.toThrow(
      /"status" must be one of/,
    );
    await expect(forms.setStatus('', 'read')).rejects.toThrow(/"submissionId"/);
  });
});
