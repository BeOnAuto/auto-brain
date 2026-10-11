import type { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import type { StreamedContent } from './streamed-content.ts';

export interface RecordedContent {
  readonly put: (brain: BrainAddress, sha256: string, content: StreamedContent) => Effect.Effect<void>;
  readonly get: (brain: BrainAddress, sha256: string) => Effect.Effect<StreamedContent | undefined>;
  readonly stage: (brain: BrainAddress, build: string, sha256: string, content: StreamedContent) => Effect.Effect<void>;
  readonly staged: (brain: BrainAddress, build: string, sha256: string) => Effect.Effect<StreamedContent | undefined>;
  readonly unstage: (brain: BrainAddress, build: string) => Effect.Effect<void>;
}

export interface BrainContentReader {
  readonly readContent: (sha256: string) => Effect.Effect<StreamedContent | undefined>;
}
