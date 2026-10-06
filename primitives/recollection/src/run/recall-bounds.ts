import { mostResultBytes } from '@beonauto/specs';
import { liftedLimits, mostEvaluationDepth, mostValueDepth, type ProgramLimits } from '@beonauto/workflow-engine/dsl';
import type { FoldingSettings } from '@beonauto/workflow-host';

import { foldDialect, foldVariable } from '../document/recall-dialects.ts';

export const recallBounds = {
  mostFilters: 8,
  mostWork: 16_000_000,
  foldDeadlineMs: 10_000,
  deadlineMs: 10_000,
  heapMegabytes: 256,
  mostViewBytes: 524_288,
  mostValueDepth,
  mostEvaluationDepth,
  overtimesBeforeStall: 20,
  pageBudgetMs: 2000,
  pagesPerWake: 10,
  mostFunctions: 32,
  rebuildsAtOnce: 4,
  brainsAtOnce: 4,
} as const;

const recordRoomBytes = 2048;

export const mostOutputBytes = mostResultBytes - recordRoomBytes;

export const recallLimits: ProgramLimits = liftedLimits(recallBounds.mostWork);

export const recallFolding: FoldingSettings = {
  dialect: foldDialect,
  variable: foldVariable,
  limits: recallLimits,
  foldDeadlineMs: recallBounds.foldDeadlineMs,
  pageBudgetMs: recallBounds.pageBudgetMs,
  mostViewBytes: recallBounds.mostViewBytes,
  worker: new URL('./fold-worker.ts', import.meta.url),
};

export const recallDefinitionType = 'recollection';
