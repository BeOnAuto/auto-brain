import { Schema, Struct } from 'effect';

import { foldPageData } from '../folds/fold-answer.ts';
import { foldProgress, type FoldPlace } from '../folds/fold-progress.ts';
import { FoldAnswerSchema, type FoldAnswer } from '../jobs/fold-messages.ts';
import { isInterrupted, type Ending } from '../jobs/job-endings.ts';
import type { FoldEnding, FoldRequest } from '../jobs/pool-contract.ts';
import type { Evaluate, Job } from './pool-job.ts';

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
  const page = foldPageData(Struct.omit(request, ['waitMs', 'deadlineMs', 'worker']));
  const progress = foldProgress();
  const job: Job<FoldAnswer> = {
    module,
    envelope: (id) => ({ job: id, kind: 'fold', request: page, progress: progress.shared }),
    decode: decodeFoldAnswer,
  };
  return {
    waitMs,
    run: async () =>
      withProgress(await evaluate(job, { until: performance.now() + deadlineMs, signal }), progress.last()),
  };
}
