import { HttpClient } from '../core/http-client';
import { XenitionError } from '../core/errors';
import { API_ENDPOINTS } from '../constants';
import {
  AiKeyRecord,
  AiUsage,
  ChatDelta,
  ChatMessage,
  ChatOptions,
  ChatOutput,
  CreateAiKeyInput,
  GenerateEmbeddingsOptions,
  GenerateEmbeddingsOutput,
  GenerateImageOptions,
  GenerateImageOutput,
  GenerateTextOptions,
  GenerateTextOutput,
  GenerateVideoOptions,
  GenerateVideoOutput,
  SpeechOptions,
  SpeechOutput,
  TranscribeOptions,
  TranscribeOutput,
  UpdateAiKeyInput,
} from './types';

/**
 * AI surface for generated apps. One SDK, many providers — xenition routes
 * each call to the right backend (OpenRouter / OpenAI / Runware / fal / …)
 * based on `options.provider` or a sensible default per kind.
 *
 *   // text / chat / embeddings default to OpenRouter
 *   const { text } = await client.ai.generateText('Summarize this post');
 *
 *   // images default to Runware; video → fal
 *   const { images } = await client.ai.generateImage('a red fox in snow');
 *   const { videos } = await client.ai.generateVideo('a red fox running');
 *
 * BYOK: sellers bring their own key via `client.ai.keys.create({ provider,
 * apiKey, displayName })`. If a key is set for a provider, xenition uses
 * it instead of the platform key (and stops billing ai_credits).
 */
/**
 * The one thing an empty AI response almost always means.
 *
 * When an app has no AI provider key the gateway still answers 200, with
 * an empty array (and `usedOwnKey: false`). Passing that back as success
 * is the worst kind of failure: nothing throws, and the problem reappears
 * far away as an empty search result or a blank image, with nothing
 * pointing back at the missing key.
 */
function noProviderKey(method: string, what: string): XenitionError {
  return new XenitionError(
    'VALIDATION_ERROR',
    `AiClient.${method}: the platform ${what}. This app has no AI provider key ` +
      'configured, so AI calls return empty results instead of failing. Add one in ' +
      'the Xenition dashboard under Manage -> AI.',
  );
}

export class AiClient {
  readonly keys: AiKeysClient;

  constructor(private readonly http: HttpClient) {
    this.keys = new AiKeysClient(http);
  }

  async generateText(
    prompt: string,
    options: GenerateTextOptions = {},
  ): Promise<GenerateTextOutput> {
    return this.http.post<GenerateTextOutput>(API_ENDPOINTS.AI.TEXT, {
      prompt,
      ...options,
    });
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatOutput> {
    return this.http.post<ChatOutput>(API_ENDPOINTS.AI.CHAT, {
      messages,
      ...options,
    });
  }

  async generateImage(
    prompt: string,
    options: GenerateImageOptions = {},
  ): Promise<GenerateImageOutput> {
    const result = await this.http.post<GenerateImageOutput>(API_ENDPOINTS.AI.IMAGE, {
      prompt,
      ...options,
    });
    if ((result?.images?.length ?? 0) === 0) {
      throw noProviderKey('generateImage', 'returned no images');
    }
    return result;
  }

  async generateVideo(
    prompt: string,
    options: GenerateVideoOptions = {},
  ): Promise<GenerateVideoOutput> {
    return this.http.post<GenerateVideoOutput>(API_ENDPOINTS.AI.VIDEO, {
      prompt,
      ...options,
    });
  }

  async generateEmbeddings(
    input: string | string[],
    options: GenerateEmbeddingsOptions = {},
  ): Promise<GenerateEmbeddingsOutput> {
    const inputs = Array.isArray(input) ? input : [input];
    const result = await this.http.post<GenerateEmbeddingsOutput>(
      API_ENDPOINTS.AI.EMBEDDINGS,
      { input: inputs, ...options },
    );
    // With no AI provider key configured the gateway answers 200 with an
    // empty array. Returning that as success hands the caller a vector
    // set with nothing in it, and the failure only surfaces much later as
    // a similarity search that matches nothing.
    if (inputs.length > 0 && (result?.embeddings?.length ?? 0) === 0) {
      throw noProviderKey('generateEmbeddings', 'returned no vectors');
    }
    return result;
  }

  /**
   * Chat, but the reply comes back parsed and shape-checked.
   *
   * `responseFormat: { type: 'json_schema' }` asks the provider for JSON —
   * it does not guarantee you get it. Providers still occasionally wrap the
   * object in prose, emit a trailing comma, or truncate at the token limit.
   * So every caller writes the same defensive `JSON.parse` in a try/catch
   * with a fallback, and the two apps built on this SDK each wrote it twice.
   *
   *   const score = await ai.chatJson<Score>(messages, SCORE_SCHEMA);
   *
   * Throws `AI_UNPARSEABLE` rather than returning a half-built object: a
   * score of 0 because the JSON was malformed is worse than an error,
   * because it silently becomes the user's result.
   *
   * The schema is sent to the provider AND used to check the reply has the
   * required keys. This is a shape check, not full JSON Schema validation —
   * enough to catch a truncated or wrapped reply, which is what actually
   * goes wrong.
   */
  async chatJson<T = Record<string, unknown>>(
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    options: Omit<ChatOptions, 'responseFormat'> = {},
  ): Promise<T> {
    const result = await this.chat(messages, {
      ...options,
      responseFormat: { type: 'json_schema', schema },
    });
    const raw = result.message?.content ?? '';
    return parseJsonReply<T>(raw, schema);
  }

  // ────────── Speech ───────────────────────────────────────────────────────

  /**
   * Transcribe recorded audio.
   *
   * Pass a URL the platform can fetch — typically the one
   * `storage.createSignedUrl()` just produced — rather than the bytes, so a
   * long recording never travels through the app's worker.
   *
   * Ask for `wordTimestamps` whenever the app shows pace, filler words or
   * pauses. Those are measured from the timings; they cannot be recovered
   * from plain text afterwards.
   */
  async transcribe(
    audioUrl: string,
    options: TranscribeOptions = {},
  ): Promise<TranscribeOutput> {
    if (typeof audioUrl !== 'string' || audioUrl.trim() === '') {
      throw new XenitionError(
        'VALIDATION_ERROR',
        'AiClient.transcribe: "audioUrl" must be a non-empty URL the platform can fetch.',
      );
    }
    return this.http.post<TranscribeOutput>(API_ENDPOINTS.AI.TRANSCRIBE, {
      audioUrl,
      ...options,
    });
  }

  /** Render text as speech. Returns a URL, not bytes, for the same reason. */
  async speech(text: string, options: SpeechOptions = {}): Promise<SpeechOutput> {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new XenitionError(
        'VALIDATION_ERROR',
        'AiClient.speech: "text" must be a non-empty string.',
      );
    }
    return this.http.post<SpeechOutput>(API_ENDPOINTS.AI.SPEECH, { text, ...options });
  }

  // ────────── Streaming ────────────────────────────────────────────────────

  /**
   * Stream a chat reply token by token.
   *
   *   for await (const delta of client.ai.streamChat(messages)) {
   *     if (delta.text) process.stdout.write(delta.text);
   *   }
   *
   * Uses `fetch` directly rather than the shared axios client, because the
   * point of streaming is to consume the body as it arrives and axios has
   * already buffered it by the time a caller sees anything.
   *
   * A 20-second wait staring at a spinner is what a non-streaming chat UI
   * feels like, so this is not a nicety.
   */
  async *streamChat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncGenerator<ChatDelta, void, unknown> {
    const response = await this.http.stream(API_ENDPOINTS.AI.CHAT_STREAM, {
      messages,
      ...options,
      stream: true,
    });
    yield* parseSseStream(response);
  }
}

/**
 * Parse a model's JSON reply, tolerating the ways providers wrap it.
 *
 * Fenced code blocks and leading prose are common enough that stripping
 * them is worth doing before giving up — the alternative is failing a job
 * over a markdown fence the model added unasked.
 */
export function parseJsonReply<T = Record<string, unknown>>(
  raw: string,
  schema?: Record<string, unknown>,
): T {
  const text = raw.trim();
  const candidates = [text, stripFence(text), sliceOutermostObject(text)].filter(
    (c): c is string => Boolean(c),
  );

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;

    const missing = missingRequired(parsed as Record<string, unknown>, schema);
    if (missing.length > 0) {
      throw new XenitionError(
        'AI_UNPARSEABLE',
        `AiClient.chatJson: reply is missing required field(s): ${missing.join(', ')}.`,
        { details: { missing, raw: text.slice(0, 400) } },
      );
    }
    return parsed as T;
  }

  throw new XenitionError(
    'AI_UNPARSEABLE',
    'AiClient.chatJson: the model did not return parseable JSON.',
    { details: { raw: text.slice(0, 400) } },
  );
}

/** ```json … ``` — the most common unasked-for wrapper. */
function stripFence(text: string): string | null {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return match?.[1]?.trim() ?? null;
}

/** Everything between the first `{` and the last `}` — strips leading prose. */
function sliceOutermostObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}

/**
 * Required top-level keys the reply does not have.
 *
 * Deliberately shallow: the failure worth catching is a truncated or
 * wrapped reply, and a full JSON Schema validator is a dependency this SDK
 * does not need for that.
 */
function missingRequired(
  value: Record<string, unknown>,
  schema?: Record<string, unknown>,
): string[] {
  const required = schema?.required;
  if (!Array.isArray(required)) return [];
  return required.filter((key) => typeof key === 'string' && !(key in value)) as string[];
}

/**
 * Parse a `text/event-stream` body into deltas.
 *
 * The wire format is the OpenAI-shaped convention every provider now
 * follows: `data: {json}` lines, blank line between events, and a literal
 * `data: [DONE]` sentinel at the end.
 */
export async function* parseSseStream(
  response: Response,
): AsyncGenerator<ChatDelta, void, unknown> {
  const body = response.body;
  if (!body) {
    throw new XenitionError('SERVER_ERROR', 'AiClient.streamChat: response carried no body.');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line. Anything after the last one
      // is a partial event and stays in the buffer for the next chunk —
      // a token boundary landing mid-JSON is the normal case, not an edge one.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const delta = parseSseEvent(event);
        if (delta) {
          yield delta;
          if (delta.done) return;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    const trailing = parseSseEvent(buffer);
    if (trailing) yield trailing;
  } finally {
    // Abandoning a stream mid-iteration (a `break`, a thrown error) must
    // not leave the connection open.
    await reader.cancel().catch(() => undefined);
  }
}

function parseSseEvent(event: string): ChatDelta | null {
  const dataLines = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;

  const payload = dataLines.join('\n');
  if (payload === '[DONE]') return { text: '', done: true };

  try {
    const parsed = JSON.parse(payload) as {
      text?: string;
      delta?: string;
      done?: boolean;
      usage?: AiUsage;
      model?: string;
    };
    return {
      text: parsed.text ?? parsed.delta ?? '',
      done: parsed.done === true,
      usage: parsed.usage,
      model: parsed.model,
    };
  } catch {
    // A malformed frame must not kill a stream that is otherwise fine —
    // the next token is usually right behind it.
    return null;
  }
}

/**
 * BYOK key management. All methods require a service key.
 */
export class AiKeysClient {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<AiKeyRecord[]> {
    return this.http.get<AiKeyRecord[]>(API_ENDPOINTS.AI.KEYS);
  }

  create(input: CreateAiKeyInput): Promise<AiKeyRecord> {
    return this.http.post<AiKeyRecord>(API_ENDPOINTS.AI.KEYS, input);
  }

  update(id: string, patch: UpdateAiKeyInput): Promise<AiKeyRecord> {
    return this.http.patch<AiKeyRecord>(API_ENDPOINTS.AI.KEY(id), patch);
  }

  async delete(id: string): Promise<void> {
    await this.http.del<void>(API_ENDPOINTS.AI.KEY(id));
  }
}
