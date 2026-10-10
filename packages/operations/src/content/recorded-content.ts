import type { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';

export interface RecordedContent {
  readonly put: (brain: BrainAddress, sha256: string, text: string) => Effect.Effect<void>;
  readonly get: (brain: BrainAddress, sha256: string) => Effect.Effect<string | undefined>;
}

export interface BrainContentReader {
  readonly readContent: (sha256: string) => Effect.Effect<string | undefined>;
}
