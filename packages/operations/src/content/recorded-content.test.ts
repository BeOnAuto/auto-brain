import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptTextOf } from '../testing/kept-text.ts';
import { mostContentChunkBytes } from './content-chunks.ts';
import { sha256Of } from './content-digest.ts';
import { notTheBytesOfItsDigest } from './content-refusals.ts';
import { memoryRecordedContent } from './memory-content.ts';
import type { RecordedContent } from './recorded-content.ts';
import { textOfContent, textToKeep, type ContentToKeep, type StreamedContent } from './streamed-content.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const json = 'application/json';

const octets = 'application/octet-stream';

function readBack(content: StreamedContent | undefined) {
  return content === undefined
    ? Effect.succeed(content)
    : Effect.map(textOfContent(content), (text) => ({ text, bytes: content.bytes, mediaType: content.mediaType }));
}

function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

function refusalOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

interface Watched {
  readonly content: ContentToKeep;
  readonly pulls: () => number;
  readonly cancelled: () => boolean;
}

function watched(text: string, mediaType = json): Watched {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
      cancel: () => {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { content: { stream, mediaType }, pulls: () => pulls, cancelled: () => cancelled };
}

function failingAfter(text: string, failure: Readonly<Error>): ContentToKeep {
  let delivered = false;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (delivered) {
        controller.error(failure);
        return;
      }
      delivered = true;
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
  return { stream, mediaType: octets };
}

describe('the content a playbook recorded', () => {
  it('answers the digest, the size and the media type of what it keeps, and reads it back in its playbook alone', async () => {
    const content = memoryRecordedContent();

    const kept = await run(content.put(alpha, textToKeep('{"rows":[1]}', json)));
    const read = await run(
      Effect.all([
        Effect.flatMap(content.get(alpha, kept.sha256), readBack),
        Effect.flatMap(content.get(alpha, kept.sha256), readBack),
        content.get(beta, kept.sha256),
        content.get(alpha, sha256Of('another')),
      ]),
    );

    expect(kept).toEqual({ sha256: sha256Of('{"rows":[1]}'), bytes: 12, mediaType: json });
    expect(read).toEqual([
      { text: '{"rows":[1]}', bytes: 12, mediaType: json },
      { text: '{"rows":[1]}', bytes: 12, mediaType: json },
      undefined,
      undefined,
    ]);
  });

  it('keeps a digest it holds once, with the media type it was first kept with, and answers that one', async () => {
    const content = memoryRecordedContent();
    await run(content.put(alpha, textToKeep('model', octets)));

    const again = await run(content.put(alpha, textToKeep('model', 'text/plain')));

    expect(again).toEqual({ sha256: sha256Of('model'), bytes: 5, mediaType: octets });
    expect(await run(Effect.flatMap(content.get(alpha, again.sha256), readBack))).toEqual({
      text: 'model',
      bytes: 5,
      mediaType: octets,
    });
  });
});

describe('the content a playbook recorded, of any size', () => {
  it('keeps bytes of several chunks whole, and no bytes as an empty content', async () => {
    const content = memoryRecordedContent();
    const text = 'é'.repeat(mostContentChunkBytes + 7);

    const kept = await run(
      Effect.all([content.put(alpha, textToKeep(text, 'text/plain')), content.put(alpha, textToKeep('', json))]),
    );

    expect(kept).toEqual([
      { sha256: sha256Of(text), bytes: 2 * text.length, mediaType: 'text/plain' },
      { sha256: sha256Of(''), bytes: 0, mediaType: json },
    ]);
    await expect(keptTextOf(content, alpha, sha256Of(text))).resolves.toBe(text);
    await expect(keptTextOf(content, alpha, sha256Of(''))).resolves.toBe('');
  });
});

describe('the content a playbook recorded, refused', () => {
  it('names a content a read found to be other bytes than its digest names', () => {
    expect(notTheBytesOfItsDigest('9f3e').message).toBe(
      'The content kept under 9f3e is not the bytes that digest names',
    );
  });

  it('refuses, and keeps nothing of, bytes of another digest or size than the one expected', async () => {
    const content = memoryRecordedContent();
    const expected = sha256Of('kept');

    const refused = await Promise.all([
      refusalOf(content.put(alpha, { ...textToKeep('other', json), expected: { sha256: expected } })),
      refusalOf(content.put(alpha, { ...textToKeep('kept', json), expected: { sha256: expected, bytes: 5 } })),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({
        _tag: 'content_refused',
        because: 'not_its_digest',
        detail: `The content's SHA-256 is ${sha256Of('other')}, where ${expected} was expected`,
      }),
      expect.objectContaining({
        _tag: 'content_refused',
        because: 'not_its_size',
        detail: 'The content holds 4 bytes, where 5 were expected',
      }),
    ]);
    expect(await run(Effect.all([content.get(alpha, expected), content.get(alpha, sha256Of('other'))]))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('refuses a stream that fails before its end, carrying its error, and keeps nothing of it', async () => {
    const content = memoryRecordedContent();
    const dropped = new Error('The connection dropped');

    const refused = await refusalOf(content.put(alpha, failingAfter('half', dropped)));

    expect(refused).toMatchObject({
      _tag: 'content_refused',
      because: 'stream_failed',
      detail: "The content's stream failed before its end",
    });
    expect(refused.cause).toBe(dropped);
    expect(await run(content.get(alpha, sha256Of('half')))).toBeUndefined();
  });
});

describe('the text a playbook recorded', () => {
  it('reads back as the text it was put as, and as nothing for a digest the playbook does not hold', async () => {
    const content = memoryRecordedContent();
    const { sha256 } = await run(content.put(alpha, textToKeep('{"rows":[]}', json)));

    await expect(keptTextOf(content, alpha, sha256)).resolves.toBe('{"rows":[]}');
    await expect(keptTextOf(content, beta, sha256)).resolves.toBeUndefined();
  });
});

function stagedTwice(content: RecordedContent) {
  return Effect.gen(function* () {
    const { sha256 } = yield* content.stage(alpha, 'run-1', textToKeep('model', octets));
    yield* content.stage(alpha, 'run-2', textToKeep('model', octets));
    return sha256;
  });
}

describe('the content staged under a run', () => {
  it('reads back under its playbook and run alone until the run is unstaged, which leaves the other runs', async () => {
    const content = memoryRecordedContent();

    const read = await run(
      Effect.gen(function* () {
        const sha256 = yield* stagedTwice(content);
        const before = [
          yield* Effect.flatMap(content.staged(alpha, 'run-1', sha256), readBack),
          yield* content.staged(beta, 'run-1', sha256),
          yield* content.get(alpha, sha256),
        ];
        yield* content.unstage(alpha, 'run-1');
        yield* content.unstage(alpha, 'run-3');
        return [
          ...before,
          yield* content.staged(alpha, 'run-1', sha256),
          yield* Effect.flatMap(content.staged(alpha, 'run-2', sha256), readBack),
        ];
      }),
    );

    expect(read).toEqual([
      { text: 'model', bytes: 5, mediaType: octets },
      undefined,
      undefined,
      undefined,
      { text: 'model', bytes: 5, mediaType: octets },
    ]);
  });

  it('is read when its read runs, not when the read is made', async () => {
    const content = memoryRecordedContent();
    const read = content.staged(alpha, 'run-1', sha256Of('model'));

    await run(content.stage(alpha, 'run-1', textToKeep('model', octets)));

    expect(await run(Effect.flatMap(read, readBack))).toEqual({ text: 'model', bytes: 5, mediaType: octets });
  });
});

describe('the content staged under a run that was unstaged', () => {
  it('is refused, leaving the stream unread, and keeps nothing a stage in flight took', async () => {
    const content = memoryRecordedContent();
    await run(content.unstage(alpha, 'run-1'));
    const late = watched('model', octets);
    let unstagedWhileRead = false;
    const racing = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        await run(content.unstage(alpha, 'run-2'));
        unstagedWhileRead = true;
        controller.enqueue(new TextEncoder().encode('model'));
        controller.close();
      },
    });

    const refused = await Promise.all([
      refusalOf(content.stage(alpha, 'run-1', late.content)),
      refusalOf(content.stage(alpha, 'run-2', { stream: racing, mediaType: octets })),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({
        _tag: 'staging_ended',
        detail: 'Nothing more is staged under run run-1, since what it staged was removed',
      }),
      expect.objectContaining({ _tag: 'staging_ended', run: 'run-2' }),
    ]);
    expect([late.pulls(), late.cancelled(), unstagedWhileRead]).toEqual([0, true, true]);
    expect(await run(content.staged(alpha, 'run-2', sha256Of('model')))).toBeUndefined();
  });
});
