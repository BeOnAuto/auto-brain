import type { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';

export interface RecordedContent {
  readonly put: (playbook: PlaybookAddress, sha256: string, text: string) => Effect.Effect<void>;
  readonly get: (playbook: PlaybookAddress, sha256: string) => Effect.Effect<string | undefined>;
}

export interface PlaybookContentReader {
  readonly readContent: (sha256: string) => Effect.Effect<string | undefined>;
}
