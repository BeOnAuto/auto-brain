import { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import { streamPrefixOfBrain } from '../ledger/bound-ports.ts';
import type { RecordedContent } from './recorded-content.ts';

function keyOf(brain: BrainAddress, sha256: string): string {
  return `${streamPrefixOfBrain(brain)}${sha256}`;
}

export function memoryRecordedContent(): RecordedContent {
  const kept = new Map<string, string>();
  return {
    put: (brain, sha256, text) =>
      Effect.sync(() => {
        const key = keyOf(brain, sha256);
        if (!kept.has(key)) {
          kept.set(key, text);
        }
      }),
    get: (brain, sha256) => Effect.sync(() => kept.get(keyOf(brain, sha256))),
  };
}
