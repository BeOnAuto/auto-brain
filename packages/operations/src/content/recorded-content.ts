import type { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import type { ContentRefused } from './content-refusals.ts';
import type { StagingEnded } from './staging-ended.ts';
import type { ContentToKeep, StreamedContent } from './streamed-content.ts';

export interface Digested {
  readonly sha256: string;
  readonly bytes: number;
}

export interface ContentKept extends Digested {
  readonly mediaType: string;
}

export interface RecordedContent {
  readonly put: (brain: BrainAddress, content: ContentToKeep) => Effect.Effect<ContentKept, ContentRefused>;
  readonly get: (brain: BrainAddress, sha256: string) => Effect.Effect<StreamedContent | undefined>;
  readonly stage: (
    brain: BrainAddress,
    run: string,
    content: ContentToKeep,
  ) => Effect.Effect<ContentKept, ContentRefused | StagingEnded>;
  readonly staged: (brain: BrainAddress, run: string, sha256: string) => Effect.Effect<StreamedContent | undefined>;
  readonly unstage: (brain: BrainAddress, run: string) => Effect.Effect<void>;
}

export interface BrainContentReader {
  readonly readContent: (sha256: string) => Effect.Effect<StreamedContent | undefined>;
}
