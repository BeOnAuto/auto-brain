import { Effect, Predicate } from 'effect';

import { textOfContent } from '../content/streamed-content.ts';
import { BrainReader } from '../ledger/brain-reader.ts';
import type { KeptContent } from './presenter.ts';
import type { RecordedFact } from './recorded-read.ts';

const digestEnding = '_sha256';

function digestsKeptIn(data: unknown, mostBytes: number): readonly string[] {
  if (!Predicate.isObject(data)) {
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
  records: readonly RecordedFact[],
  mostBytes: number,
): Effect.Effect<KeptContent, never, BrainReader> {
  const digests = [...new Set(records.flatMap(({ data }) => digestsKeptIn(data, mostBytes)))];
  return Effect.gen(function* () {
    const reader = yield* BrainReader;
    const kept = new Map<string, string>();
    for (const digest of digests) {
      const content = yield* reader.readContent(digest);
      if (content !== undefined) {
        kept.set(digest, yield* textOfContent(content));
      }
    }
    return (sha256: string) => kept.get(sha256);
  });
}
