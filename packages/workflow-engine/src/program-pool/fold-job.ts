import { Schema } from 'effect';

import type { FoldPage } from '../folds/fold-page.ts';
import { foldPageData } from './fold-answer.ts';
import { FoldAnswerSchema, type FoldAnswer } from './fold-messages.ts';
import { foldProgress, type FoldPlace } from './fold-progress.ts';
import { isInterrupted, type Ending, type Evaluate, type Interrupted, type Job } from './pool-job.ts';

export interface FoldRequest extends FoldPage {
  readonly waitMs: number;
  readonly deadlineMs: number;
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
  const { waitMs, deadlineMs, ...page } = request;
  const progress = foldProgress();
  const job: Job<FoldAnswer> = {
    module,
    workerData: { ...foldPageData(page), progress: { shared: progress.shared } },
    decode: decodeFoldAnswer,
  };
  return {
    waitMs,
    run: async () =>
      withProgress(await evaluate(job, { until: performance.now() + deadlineMs, signal }), progress.last()),
  };
}
