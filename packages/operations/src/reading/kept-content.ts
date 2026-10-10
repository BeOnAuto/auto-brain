import { Effect, Predicate } from 'effect';

import { BrainReader } from '../ledger/brain-reader.ts';
import type { KeptContent } from './presenter.ts';
import type { RecordedEvent } from './recorded-read.ts';

const digestEnding = '_sha256';

function digestsKeptIn(data: unknown, mostBytes: number): readonly string[] {
  if (!Predicate.isObject(data) || Reflect.get(data, 'content_kept') !== true) {
    return [];
  }
  const digests: string[] = [];
  for (const [key, digest] of Object.entries(data)) {
    const bytes: unknown = Reflect.get(data, `${key.slice(0, -digestEnding.length)}_bytes`);
    if (key.endsWith(digestEnding) && typeof digest === 'string' && typeof bytes === 'number' && bytes <= mostBytes) {
      digests.push(digest);
    }
  }
  return digests;
}

export const nothingKept: KeptContent = (sha256) => new Map<string, string>().get(sha256);

export function keptContentOf(
  records: readonly RecordedEvent[],
  mostBytes: number,
): Effect.Effect<KeptContent, never, BrainReader> {
  const digests = [...new Set(records.flatMap(({ data }) => digestsKeptIn(data, mostBytes)))];
  return Effect.gen(function* () {
    const reader = yield* BrainReader;
    const kept = new Map<string, string>();
    for (const digest of digests) {
      const text = yield* reader.readContent(digest);
      if (text !== undefined) {
        kept.set(digest, text);
      }
    }
    return (sha256: string) => kept.get(sha256);
  });
}
