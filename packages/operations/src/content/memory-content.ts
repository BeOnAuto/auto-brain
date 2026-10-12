import { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
import type { RecordedContent } from './recorded-content.ts';

function keyOf(playbook: PlaybookAddress, sha256: string): string {
  return `${streamPrefixOfPlaybook(playbook)}${sha256}`;
}

export function memoryRecordedContent(): RecordedContent {
  const kept = new Map<string, string>();
  return {
    put: (playbook, sha256, text) =>
      Effect.sync(() => {
        const key = keyOf(playbook, sha256);
        if (!kept.has(key)) {
          kept.set(key, text);
        }
      }),
    get: (playbook, sha256) => Effect.sync(() => kept.get(keyOf(playbook, sha256))),
  };
}
