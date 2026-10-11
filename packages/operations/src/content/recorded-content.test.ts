import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptTextOf } from '../testing/kept-text.ts';
import { sha256Of } from './content-chunks.ts';
import { memoryRecordedContent } from './memory-content.ts';
import { contentOfText, textOfContent, type StreamedContent } from './streamed-content.ts';

const alpha = { org: 'acme', brain: 'alpha' };

const beta = { org: 'acme', brain: 'beta' };

const json = 'application/json';

function readBack(content: StreamedContent | undefined) {
  return content === undefined
    ? Effect.succeed(content)
    : Effect.map(textOfContent(content), (text) => ({ text, bytes: content.bytes, mediaType: content.mediaType }));
}

function model(): StreamedContent {
  return contentOfText('model', 'application/octet-stream');
}

function cancelledOnce(text: string): { readonly content: StreamedContent; readonly cancelled: () => boolean } {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
    cancel: () => {
      cancelled = true;
    },
  });
  return { content: { stream, bytes: text.length, mediaType: json }, cancelled: () => cancelled };
}

describe('the content a brain recorded', () => {
  it('keeps a digest once, with its media type, and reads it back in its brain alone, as often as it is read', async () => {
    const content = memoryRecordedContent();
    const sha256 = await sha256Of('{"rows":[1]}');
    const another = await sha256Of('another');
    const again = cancelledOnce('{"rows":[1]}');

    const read = await Effect.runPromise(
      Effect.gen(function* () {
        yield* content.put(alpha, sha256, contentOfText('{"rows":[1]}', json));
        yield* content.put(alpha, sha256, again.content);
        return [
          yield* Effect.flatMap(content.get(alpha, sha256), readBack),
          yield* Effect.flatMap(content.get(alpha, sha256), readBack),
          yield* content.get(beta, sha256),
          yield* content.get(alpha, another),
        ];
      }),
    );

    expect(read).toEqual([
      { text: '{"rows":[1]}', bytes: 12, mediaType: json },
      { text: '{"rows":[1]}', bytes: 12, mediaType: json },
      undefined,
      undefined,
    ]);
    expect(again.cancelled()).toBe(true);
  });

  it('keeps nothing put under a digest that is not its bytes, or of another size than it declares', async () => {
    const content = memoryRecordedContent();
    const sha256 = await sha256Of('kept');

    await expect(Effect.runPromise(content.put(alpha, sha256, contentOfText('other', json)))).rejects.toThrow(
      `The content put under ${sha256} is not the bytes that digest names`,
    );
    await expect(
      Effect.runPromise(content.put(alpha, sha256, { ...contentOfText('kept', json), bytes: 5 })),
    ).rejects.toThrow(`The content put under ${sha256} holds 4 bytes, not the 5 it declares`);
    expect(await Effect.runPromise(content.get(alpha, sha256))).toBeUndefined();
  });
});

describe('the text a brain recorded', () => {
  it('reads back as the text it was put as, and as nothing for a digest the brain does not hold', async () => {
    const content = memoryRecordedContent();
    const sha256 = await sha256Of('{"rows":[]}');
    await Effect.runPromise(content.put(alpha, sha256, contentOfText('{"rows":[]}', json)));

    await expect(keptTextOf(content, alpha, sha256)).resolves.toBe('{"rows":[]}');
    await expect(keptTextOf(content, beta, sha256)).resolves.toBeUndefined();
  });
});

describe('the content staged under a build', () => {
  it('reads back under its brain and build alone until the build is unstaged, which leaves the other builds', async () => {
    const content = memoryRecordedContent();
    const sha256 = await sha256Of('model');

    const read = await Effect.runPromise(
      Effect.gen(function* () {
        yield* content.stage(alpha, 'build-1', sha256, model());
        yield* content.stage(alpha, 'build-1', sha256, model());
        yield* content.stage(alpha, 'build-2', sha256, model());
        const before = [
          yield* Effect.flatMap(content.staged(alpha, 'build-1', sha256), readBack),
          yield* content.staged(beta, 'build-1', sha256),
          yield* content.get(alpha, sha256),
        ];
        yield* content.unstage(alpha, 'build-1');
        yield* content.unstage(alpha, 'build-3');
        return [
          ...before,
          yield* content.staged(alpha, 'build-1', sha256),
          yield* Effect.flatMap(content.staged(alpha, 'build-2', sha256), readBack),
        ];
      }),
    );

    expect(read).toEqual([
      { text: 'model', bytes: 5, mediaType: 'application/octet-stream' },
      undefined,
      undefined,
      undefined,
      { text: 'model', bytes: 5, mediaType: 'application/octet-stream' },
    ]);
  });
});
