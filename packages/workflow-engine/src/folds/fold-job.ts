import { Schema, Struct } from 'effect';

import { isInterrupted, type Ending, type Evaluate, type Interrupted, type Job } from '../program-pool/pool-job.ts';
import { foldPageData } from './fold-answer.ts';
import { FoldAnswerSchema, type FoldAnswer } from './fold-messages.ts';
import type { FoldPage } from './fold-page.ts';
import { foldProgress, type FoldPlace } from './fold-progress.ts';

export interface FoldRequest extends FoldPage {
  readonly waitMs: number;
  readonly deadlineMs: number;
  readonly worker?: Readonly<URL>;
}

type FoldEnding = FoldAnswer | (Interrupted & { readonly progress?: FoldPlace });

export type FoldOutcome = FoldEnding & { readonly milliseconds: number };

export interface FoldJob {
  readonly waitMs: number;
  readonly run: () => Promise<FoldEnding>;
}

const decodeFoldAnswer = Schema.decodeUnknownOption(FoldAnswerSchema);

function withProgress(ending: Ending<FoldAnswer>, place: FoldPlace | undefined): FoldEnding {
  return isInterrupted(ending) && place !== undefined ? { ...ending, progress: place } : ending;
}

export function foldJobOf(
  module: Readonly<URL>,
  evaluate: Evaluate,
  request: FoldRequest,
  signal?: Readonly<AbortSignal>,
): FoldJob {
  const { waitMs, deadlineMs } = request;
  const page = Struct.omit(request, ['waitMs', 'deadlineMs', 'worker']);
  const progress = foldProgress();
  const jobFrom = (startedAt: number): Job<FoldAnswer> => ({
    module,
    workerData: { ...foldPageData({ ...page, startedAt }), progress: { shared: progress.shared } },
    decode: decodeFoldAnswer,
  });
  return {
    waitMs,
    run: async () => {
      const started = performance.now();
      const ending = await evaluate(jobFrom(performance.timeOrigin + started), { until: started + deadlineMs, signal });
      return withProgress(ending, progress.last());
    },
  };
}
