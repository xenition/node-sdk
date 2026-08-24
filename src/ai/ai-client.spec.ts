import { HttpClient } from '../core/http-client';
import { XenitionError } from '../core/errors';
import { API_ENDPOINTS } from '../constants';
import { AiClient, parseSseStream } from './ai-client';
import { ChatDelta } from './types';

const makeAi = () => {
  const post = jest.fn().mockResolvedValue({});
  const stream = jest.fn();
  return { post, stream, ai: new AiClient({ post, stream } as unknown as HttpClient) };
};

/** A Response whose body streams the given chunks, one read at a time. */
const sseResponse = (chunks: string[]): Response => {
  const encoder = new TextEncoder();
  let index = 0;
  const cancel = jest.fn(async () => undefined);
  return {
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]!) }
            : { done: true, value: undefined },
        cancel,
      }),
    },
    // exposed for the cancellation test
    __cancel: cancel,
  } as unknown as Response;
};

const collect = async (stream: AsyncGenerator<ChatDelta>): Promise<ChatDelta[]> => {
  const out: ChatDelta[] = [];
  for await (const delta of stream) out.push(delta);
  return out;
};

describe('transcribe', () => {
  it('posts the audio URL and options', async () => {
    const { post, ai } = makeAi();
    await ai.transcribe('https://cdn/rec.m4a', { wordTimestamps: true, language: 'en' });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.AI.TRANSCRIBE, {
      audioUrl: 'https://cdn/rec.m4a',
      wordTimestamps: true,
      language: 'en',
    });
  });

  it('rejects an empty URL before spending a request', async () => {
    const { post, ai } = makeAi();
    await expect(ai.transcribe('')).rejects.toBeInstanceOf(XenitionError);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('speech', () => {
  it('posts the text and voice options', async () => {
    const { post, ai } = makeAi();
    await ai.speech('hello', { voice: 'alloy', format: 'mp3' });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.AI.SPEECH, {
      text: 'hello',
      voice: 'alloy',
      format: 'mp3',
    });
  });

  it('rejects empty text', async () => {
    const { ai } = makeAi();
    await expect(ai.speech('   ')).rejects.toBeInstanceOf(XenitionError);
  });
});

describe('chat', () => {
  it('passes a response format through so replies can be schema-constrained', async () => {
    // Prompting for "reply in this exact JSON" works until it does not, and
    // then it is a parse failure in production.
    const { post, ai } = makeAi();
    const schema = { type: 'object', properties: { score: { type: 'number' } } };
    await ai.chat([{ role: 'user', content: 'score this' }], {
      responseFormat: { type: 'json_schema', schema, name: 'score' },
    });
    expect(post.mock.calls[0][1].responseFormat).toMatchObject({ type: 'json_schema', schema });
  });
});

describe('streamChat', () => {
  it('yields each delta as it arrives', async () => {
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(
      sseResponse([
        'data: {"text":"Hel"}\n\n',
        'data: {"text":"lo"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const deltas = await collect(ai.streamChat([{ role: 'user', content: 'hi' }]));
    expect(deltas.map((d) => d.text)).toEqual(['Hel', 'lo', '']);
    expect(deltas[deltas.length - 1]!.done).toBe(true);
  });

  it('reassembles an event split across chunk boundaries', async () => {
    // A token boundary landing mid-JSON is the normal case, not an edge one.
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(sseResponse(['data: {"te', 'xt":"Hello"}\n\n', 'data: [DONE]\n\n']));
    const deltas = await collect(ai.streamChat([]));
    expect(deltas[0]!.text).toBe('Hello');
  });

  it('handles several events in one chunk', async () => {
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(sseResponse(['data: {"text":"a"}\n\ndata: {"text":"b"}\n\n']));
    expect((await collect(ai.streamChat([]))).map((d) => d.text)).toEqual(['a', 'b']);
  });

  it('accepts the `delta` spelling as well as `text`', async () => {
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(sseResponse(['data: {"delta":"x"}\n\n']));
    expect((await collect(ai.streamChat([]))).map((d) => d.text)).toEqual(['x']);
  });

  it('carries usage on the final frame', async () => {
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(
      sseResponse([
        'data: {"text":"hi"}\n\n',
        'data: {"text":"","done":true,"usage":{"inputTokens":3,"outputTokens":1,"totalTokens":4},"model":"m"}\n\n',
      ]),
    );
    const deltas = await collect(ai.streamChat([]));
    expect(deltas[1]).toMatchObject({ done: true, model: 'm', usage: { totalTokens: 4 } });
  });

  it('skips a malformed frame rather than killing the stream', async () => {
    // The next token is usually right behind it.
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(
      sseResponse(['data: {not json\n\n', 'data: {"text":"ok"}\n\n']),
    );
    expect((await collect(ai.streamChat([]))).map((d) => d.text)).toEqual(['ok']);
  });

  it('ignores comment and event lines', async () => {
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(
      sseResponse([': keep-alive\n\n', 'event: message\ndata: {"text":"y"}\n\n']),
    );
    expect((await collect(ai.streamChat([]))).map((d) => d.text)).toEqual(['y']);
  });

  it('marks the request as streaming', async () => {
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(sseResponse(['data: [DONE]\n\n']));
    await collect(ai.streamChat([{ role: 'user', content: 'hi' }], { model: 'm' }));
    expect(stream).toHaveBeenCalledWith(
      API_ENDPOINTS.AI.CHAT_STREAM,
      expect.objectContaining({ stream: true, model: 'm' }),
    );
  });

  it('cancels the reader when the caller stops early', async () => {
    // Abandoning a stream must not leave the connection open.
    const response = sseResponse(['data: {"text":"a"}\n\n', 'data: {"text":"b"}\n\n']);
    const { stream, ai } = makeAi();
    stream.mockResolvedValue(response);

    for await (const delta of ai.streamChat([])) {
      expect(delta.text).toBe('a');
      break;
    }
    expect((response as unknown as { __cancel: jest.Mock }).__cancel).toHaveBeenCalled();
  });

  it('fails clearly when the response has no body', async () => {
    const { stream, ai } = makeAi();
    stream.mockResolvedValue({ body: null } as unknown as Response);
    await expect(collect(ai.streamChat([]))).rejects.toThrow(/carried no body/);
  });
});

describe('parseSseStream', () => {
  it('is usable on its own for a hand-rolled stream route', async () => {
    const deltas = await collect(
      parseSseStream(sseResponse(['data: {"text":"z"}\n\ndata: [DONE]\n\n'])),
    );
    expect(deltas.map((d) => d.text)).toEqual(['z', '']);
  });
});
