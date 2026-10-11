import { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import { streamPrefixOfBrain } from '../ledger/bound-ports.ts';
import { requireAsDeclared, sha256Of } from './content-chunks.ts';
import type { RecordedContent } from './recorded-content.ts';
import { contentOfBytes, type StreamedContent } from './streamed-content.ts';

interface KeptBytes {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

type Shelf = Map<string, KeptBytes>;

function buildKeyOf(brain: BrainAddress, build: string): string {
  return `${streamPrefixOfBrain(brain)}${build}`;
}

async function verified(sha256: string, content: StreamedContent): Promise<KeptBytes> {
  const bytes = new Uint8Array(await new Response(content.stream).arrayBuffer());
  requireAsDeclared(sha256, content.bytes, { bytes: bytes.byteLength, sha256: await sha256Of(bytes) });
  return { bytes, mediaType: content.mediaType };
}

function keptOn(shelf: Shelf, key: string, sha256: string, content: StreamedContent): Effect.Effect<void> {
  return Effect.promise(async () => {
    if (shelf.has(key)) {
      await content.stream.cancel();
      return;
    }
    shelf.set(key, await verified(sha256, content));
  });
}

function readFrom(shelf: Shelf | undefined, key: string): Effect.Effect<StreamedContent | undefined> {
  return Effect.sync(() => {
    const kept = shelf?.get(key);
    return kept === undefined ? undefined : contentOfBytes(kept.bytes, kept.mediaType);
  });
}

export function memoryRecordedContent(): RecordedContent {
  const kept: Shelf = new Map();
  const staging = new Map<string, Shelf>();
  const stagedFor = (brain: BrainAddress, build: string): Shelf => {
    const key = buildKeyOf(brain, build);
    const shelf = staging.get(key) ?? new Map<string, KeptBytes>();
    staging.set(key, shelf);
    return shelf;
  };
  return {
    put: (brain, sha256, content) => keptOn(kept, `${streamPrefixOfBrain(brain)}${sha256}`, sha256, content),
    get: (brain, sha256) => readFrom(kept, `${streamPrefixOfBrain(brain)}${sha256}`),
    stage: (brain, build, sha256, content) =>
      Effect.suspend(() => keptOn(stagedFor(brain, build), sha256, sha256, content)),
    staged: (brain, build, sha256) => readFrom(staging.get(buildKeyOf(brain, build)), sha256),
    unstage: (brain, build) =>
      Effect.sync(() => {
        staging.delete(buildKeyOf(brain, build));
      }),
  };
}
