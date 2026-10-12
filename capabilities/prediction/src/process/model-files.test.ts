import { createHash } from 'node:crypto';
import { existsSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { contentOfText, type StreamedContent } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { scratchDirectory } from '../testing/scratch.ts';
import { fileCache, mostCachedBytes, type ContentSource } from './model-files.ts';

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return contentOfText(text, 'application/octet-stream').stream;
}

function sourceOf(text: string, heard: (asked: string) => void = () => {}): ContentSource {
  return () =>
    Effect.sync((): StreamedContent => {
      heard(text);
      return contentOfText(text, 'application/octet-stream');
    });
}

function noSource(heard: (asked: string) => void = () => {}): ContentSource {
  return () =>
    Effect.andThen(
      Effect.sync(() => {
        heard('nothing');
      }),
      Effect.undefined,
    );
}

function cacheIn(directory: string, mostBytes = 1024) {
  return fileCache({ directory, extension: 'onnx', mostBytes });
}

describe('the file cache of the model processes', () => {
  it('keeps a file it receives under its digest, written whole before it is renamed in place', async () => {
    const directory = scratchDirectory();
    const kept = await Effect.runPromise(cacheIn(directory).received(streamOf('a model')));

    expect(kept).toEqual({
      sha256: digestOf('a model'),
      bytes: 7,
      path: join(directory, `${digestOf('a model')}.onnx`),
    });
    expect(readdirSync(directory)).toEqual([`${digestOf('a model')}.onnx`]);
  });

  it('finds a file it holds without asking its source, and fetches one it does not from the source, or finds none', async () => {
    const cache = cacheIn(scratchDirectory());
    const asked: string[] = [];
    const heard = (text: string) => {
      asked.push(text);
    };
    await Effect.runPromise(cache.received(streamOf('held')));

    const held = await Effect.runPromise(cache.pathOf(digestOf('held'), sourceOf('never', heard)));
    const fetched = await Effect.runPromise(cache.pathOf(digestOf('fetched'), sourceOf('fetched', heard)));
    const missing = await Effect.runPromise(cache.pathOf(digestOf('missing'), noSource(heard)));

    expect([
      held?.endsWith(`${digestOf('held')}.onnx`),
      fetched?.endsWith(`${digestOf('fetched')}.onnx`),
      missing,
    ]).toEqual([true, true, undefined]);
    expect(asked).toEqual(['fetched', 'nothing']);
  });

  it('refuses bytes that are not those of the digest asked, and keeps none of them', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory);

    const refused = await Effect.runPromiseExit(cache.pathOf(digestOf('asked'), sourceOf('other')));

    expect(Exit.hasDies(refused)).toBe(true);
    expect(readdirSync(directory)).toEqual([]);
  });
});

describe('the bytes the file cache of the model processes holds', () => {
  it('evict the files used least recently past them, never the one it has just kept', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory, 25);
    await Effect.runPromise(cache.received(streamOf('first file')));
    await Effect.runPromise(cache.received(streamOf('second file')));
    await Effect.runPromise(cache.pathOf(digestOf('first file'), noSource()));
    await Effect.runPromise(cache.received(streamOf('third file')));
    const alone = cacheIn(scratchDirectory(), 4);
    const large = await Effect.runPromise(alone.received(streamOf('larger than the cache')));

    expect(readdirSync(directory).toSorted()).toEqual(
      [`${digestOf('first file')}.onnx`, `${digestOf('third file')}.onnx`].toSorted(),
    );
    expect(existsSync(large.path)).toBe(true);
  });
});

describe('the file cache of the model processes after a restart', () => {
  it('takes the files a server left in its directory, the oldest first to go, and fetches again a file removed under it', async () => {
    const directory = scratchDirectory();
    const older = join(directory, `${digestOf('older')}.onnx`);
    writeFileSync(older, 'older');
    writeFileSync(join(directory, `${digestOf('newer')}.onnx`), 'newer');
    writeFileSync(join(directory, '.left-by-a-crash.part'), 'partial');
    utimesSync(older, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    const asked: string[] = [];
    const heard = (text: string) => {
      asked.push(text);
    };
    const cache = cacheIn(directory, 10);

    const found = await Effect.runPromise(cache.pathOf(digestOf('newer'), sourceOf('never', heard)));
    await Effect.runPromise(cache.received(streamOf('next')));
    rmSync(join(directory, `${digestOf('next')}.onnx`));
    const again = await Effect.runPromise(cache.pathOf(digestOf('next'), sourceOf('next', heard)));

    expect([found, again, asked]).toEqual([
      join(directory, `${digestOf('newer')}.onnx`),
      join(directory, `${digestOf('next')}.onnx`),
      ['next'],
    ]);
    expect(existsSync(older)).toBe(false);
  });

  it('removes what it was writing when the stream fails, and holds a gibibyte by default', async () => {
    const directory = scratchDirectory();
    const failing = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.error(new Error('The client went away'));
      },
    });

    expect(Exit.hasDies(await Effect.runPromiseExit(cacheIn(directory).received(failing)))).toBe(true);
    expect([readdirSync(directory), mostCachedBytes]).toEqual([[], 1_073_741_824]);
  });
});
