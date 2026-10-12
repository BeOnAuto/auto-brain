import { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import { streamPrefixOfBrain } from '../ledger/bound-ports.ts';
import { mostContentChunkBytes } from './content-chunks.ts';
import { leftUnread, requireExpected, takenInChunks } from './content-intake.ts';
import type { ContentRefused } from './content-refusals.ts';
import type { ContentKept, RecordedContent } from './recorded-content.ts';
import { stagingEnded, type StagingEnded } from './staging-ended.ts';
import type { ContentToKeep, StreamedContent } from './streamed-content.ts';

interface KeptBytes {
  readonly chunks: Blob;
  readonly mediaType: string;
}

type Shelf = Map<string, KeptBytes>;

interface Received {
  readonly sha256: string;
  readonly kept: KeptBytes;
}

function received({ stream, mediaType, expected }: ContentToKeep): Effect.Effect<Received, ContentRefused> {
  return Effect.gen(function* () {
    const chunks: Readonly<Uint8Array<ArrayBuffer>>[] = [];
    const taken = yield* takenInChunks(stream, mostContentChunkBytes, (chunk) =>
      Effect.sync(() => {
        chunks.push(chunk);
      }),
    );
    yield* requireExpected(expected, taken);
    return { sha256: taken.sha256, kept: { chunks: new Blob(chunks), mediaType } };
  });
}

function keptOn(shelf: Shelf, { sha256, kept }: Received): ContentKept {
  const held = shelf.get(sha256) ?? kept;
  shelf.set(sha256, held);
  return { sha256, bytes: held.chunks.size, mediaType: held.mediaType };
}

function readFrom(shelf: Shelf | undefined, sha256: string): StreamedContent | undefined {
  const kept = shelf?.get(sha256);
  return kept === undefined
    ? undefined
    : { stream: kept.chunks.stream(), bytes: kept.chunks.size, mediaType: kept.mediaType };
}

function runKeyOf(brain: BrainAddress, run: string): string {
  return `${streamPrefixOfBrain(brain)}${run}`;
}

export function memoryRecordedContent(): RecordedContent {
  const kept = new Map<string, Shelf>();
  const staging = new Map<string, Shelf>();
  const unstaged = new Set<string>();
  const shelfOf = (shelves: Map<string, Shelf>, key: string): Shelf => {
    const shelf = shelves.get(key) ?? new Map<string, KeptBytes>();
    shelves.set(key, shelf);
    return shelf;
  };
  const ended = (run: string, key: string): Effect.Effect<void, StagingEnded> =>
    Effect.suspend(() => (unstaged.has(key) ? Effect.fail(stagingEnded(run)) : Effect.void));
  return {
    put: (brain, content) =>
      Effect.map(received(content), (taken) => keptOn(shelfOf(kept, streamPrefixOfBrain(brain)), taken)),
    get: (brain, sha256) => Effect.sync(() => readFrom(kept.get(streamPrefixOfBrain(brain)), sha256)),
    stage: (brain, run, content) => {
      const key = runKeyOf(brain, run);
      return ended(run, key).pipe(
        Effect.tapError(() => leftUnread(content.stream)),
        Effect.andThen(received(content)),
        Effect.tap(() => ended(run, key)),
        Effect.map((taken) => keptOn(shelfOf(staging, key), taken)),
      );
    },
    staged: (brain, run, sha256) => Effect.sync(() => readFrom(staging.get(runKeyOf(brain, run)), sha256)),
    unstage: (brain, run) =>
      Effect.sync(() => {
        const key = runKeyOf(brain, run);
        unstaged.add(key);
        staging.delete(key);
      }),
  };
}
