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
  VideoJob,
  WaitForVideoOptions,
  SpeechOptions,
  SpeechOutput,
  TranscribeOptions,
  TranscribeOutput,
  UpdateAiKeyInput,
} from './types';

/**
 * AI surface for generated apps. Each call runs on one of two lanes:
 *
 *   OWN KEY   the app added a provider key under Manage → AI (OpenRouter,
 *             OpenAI, Gemini or Anthropic). Text, chat, streaming chat and
 *             embeddings go straight to that provider with that key, and the
 *             app pays its provider. `usedOwnKey` is true.
 *   PLATFORM  no usable key. The call runs on the Xenition engine and its real
 *             cost is charged to the app owner's credits. `provider` is
 *             `'xenition'`. Image and video always run here.
 *
 *   const { text } = await client.ai.generateText('Summarize this post');
 *   const { images } = await client.ai.generateImage('a red fox in snow');
 *
 *   // video is a job: start it, then wait (or poll getVideo from a cron)
 *   const job = await client.ai.generateVideo('a red fox running');
 *   const { videos } = await client.ai.waitForVideo(job.jobId);
 *
 * Failures are errors, not empty results: a 402 (`QUOTA_EXCEEDED`) means
 * the owner's credits are used up, a 503 means this deployment has no AI
 * engine, and a 400 naming the provider means the app's own key was refused.
 * Video needs a service key.
 *   const { videos } = await client.ai.generateVideo('a red fox running');
 *
 * BYOK: sellers bring their own key via `client.ai.keys.create({ provider,
 * apiKey, displayName })`. If a key is set for a provider, xenition uses
 * it instead of the platform key (and stops billing ai_credits).
 */
/**
 * An empty 200 from an AI route.
 *
 * Current gateways answer a call they cannot serve with an error status. Only
 * a gateway from before real AI shipped answers 200 with an empty array, so
 * that is what this names — passing the empty result back as success would
 * let the failure resurface far away as a blank image or a search that
 * matches nothing.
 */
function noProviderKey(method: string, what: string): XenitionError {
  return new XenitionError(
    'NOT_IMPLEMENTED',
    `AiClient.${method}: the platform ${what}. This gateway predates real AI ` +
      'generation and answers with placeholders; update the Xenition gateway, or ' +
      'add a provider key under Manage -> AI.',
  );
}

/**
 * True when a text reply cannot have come from a model. A real completion runs either on the app's
 * own provider key (`usedOwnKey`) or on the platform's engine (`provider: 'xenition'`). Older
 * gateways answer every text call with a fixed sentence, marked neither way, and that sentence must
 * not reach a user as if it were an answer.
 */
function isPlaceholder(reply: { usedOwnKey?: boolean; provider?: string }): boolean {
  return reply.usedOwnKey !== true && reply.provider !== 'xenition';
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const cancelled = () =>
  new XenitionError('CANCELLED', 'AiClient.waitForVideo: stopped waiting; the job keeps running.');

export class AiClient {
  readonly keys: AiKeysClient;

  constructor(private readonly http: HttpClient) {
    this.keys = new AiKeysClient(http);
  }

  async generateText(
    prompt: string,
    options: GenerateTextOptions = {},
  ): Promise<GenerateTextOutput> {
    const result = await this.http.post<GenerateTextOutput>(API_ENDPOINTS.AI.TEXT, {
      prompt,
      ...options,
    });
    if (typeof result?.text === 'string' && isPlaceholder(result)) {
      throw noProviderKey('generateText', 'answered with a placeholder instead of a completion');
    }
    return result;
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatOutput> {
    const result = await this.http.post<ChatOutput & { text?: string }>(API_ENDPOINTS.AI.CHAT, {
      messages,
      ...options,
    });
    if (typeof result?.message?.content === 'string') return result;
    // Some gateways answer chat with the text shape ({ text }) rather than { message }. A real
    // completion in that shape is returned as the message this method promises; a placeholder is
    // refused, so it is never shown to a user as the model's reply.
    if (typeof result?.text === 'string') {
      if (isPlaceholder(result)) {
        throw noProviderKey('chat', 'answered with a placeholder instead of a completion');
      }
      const { text, ...rest } = result;
      return { ...rest, message: { role: 'assistant', content: text } };
    }
    return result;
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

  /**
   * Start generating a video. Returns at once with `status: 'processing'`
   * and a `jobId`; the clip takes minutes. Follow with {@link waitForVideo},
   * or store the id and check {@link getVideo} later — a request handler
   * should not sit on a multi-minute wait. Needs a service key.
   */
  async generateVideo(
    prompt: string,
    options: GenerateVideoOptions = {},
  ): Promise<GenerateVideoOutput> {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new XenitionError('VALIDATION_ERROR', 'AiClient.generateVideo: "prompt" must be a non-empty string.');
    }
    return this.http.post<GenerateVideoOutput>(API_ENDPOINTS.AI.VIDEO, {
      prompt,
      ...options,
    });
  }

  /** The current state of a video job this app started. */
  async getVideo(jobId: string): Promise<VideoJob> {
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new XenitionError('VALIDATION_ERROR', 'AiClient.getVideo: "jobId" must be a non-empty string.');
    }
    return this.http.get<VideoJob>(API_ENDPOINTS.AI.VIDEO_JOB(jobId));
  }

  /**
   * Poll a video job until it finishes. Resolves with the completed job (its
   * `videos` filled); throws `JOB_FAILED` if generation failed, `TIMEOUT`
   * after `timeoutMs`, and `CANCELLED` when `signal` aborts. Giving up
   * does not stop the job — `getVideo()` still finds it later.
   */
  async waitForVideo(
    job: string | Pick<VideoJob, 'jobId'>,
    options: WaitForVideoOptions = {},
  ): Promise<VideoJob> {
    const jobId = typeof job === 'string' ? job : job?.jobId;
    const interval = Math.max(1000, options.intervalMs ?? 5000);
    const deadline = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000);
    for (;;) {
      if (options.signal?.aborted) throw cancelled();
      const current = await this.getVideo(jobId);
      options.onStatus?.(current);
      if (current.status === 'completed') return current;
      if (current.status === 'failed') {
        throw new XenitionError(
          'JOB_FAILED',
          `AiClient.waitForVideo: video job ${jobId} failed: ${current.error ?? 'no reason given'}`,
          { details: { jobId } },
        );
      }
      if (Date.now() + interval > deadline) {
        throw new XenitionError(
          'TIMEOUT',
          `AiClient.waitForVideo: video job ${jobId} is still processing; check it later with getVideo().`,
          { details: { jobId } },
        );
      }
      await sleep(interval, options.signal);
    }
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

  let parsed: {
    text?: string;
    delta?: string;
    done?: boolean;
    usage?: AiUsage;
    model?: string;
    provider?: ChatDelta['provider'];
    error?: string;
  };
  try {
    parsed = JSON.parse(payload);
  } catch {
    // A malformed frame must not kill a stream that is otherwise fine —
    // the next token is usually right behind it.
    return null;
  }
  // The gateway reports a provider that dropped mid-reply as a frame, since
  // the 200 status has already been sent. Ending quietly would hand the caller
  // half an answer as if it were the whole one.
  if (typeof parsed.error === 'string' && parsed.error !== '') {
    throw new XenitionError('SERVER_ERROR', `AiClient.streamChat: ${parsed.error}`);
  }
  return {
    text: parsed.text ?? parsed.delta ?? '',
    done: parsed.done === true,
    usage: parsed.usage,
    model: parsed.model,
    provider: parsed.provider,
  };
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
