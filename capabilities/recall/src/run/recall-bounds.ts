import { mostResultBytes } from '@beonauto/definitions';
import { checkedWorker } from '@beonauto/definitions/json-schema';
import { mostValueDepth, runMemoryBytes, unitMemoryBytes, workerStackBytes } from '@beonauto/workflow-engine/dsl';
import type { FoldingSettings } from '@beonauto/workflow-host';

export const recallBounds = {
  mostFilters: 8,
  budget: 500,
  foldDeadlineMs: 10_000,
  deadlineMs: 10_000,
  answerMemoryBytes: runMemoryBytes,
  foldMemoryBytes: unitMemoryBytes,
  stackBytes: workerStackBytes,
  heapMegabytes: 256,
  mostViewBytes: 524_288,
  mostValueDepth,
  overtimesBeforeStall: 20,
  pageBudgetMs: 2000,
  pagesPerWake: 10,
  mostFunctions: 32,
  rebuildsAtOnce: 4,
  brainsAtOnce: 4,
} as const;

const recordRoomBytes = 2048;

export const mostOutputBytes = mostResultBytes - recordRoomBytes;

export const mebibytes = 1_048_576;

export const recallFolding: FoldingSettings = {
  budget: recallBounds.budget,
  memoryBytes: recallBounds.foldMemoryBytes,
  stackBytes: recallBounds.stackBytes,
  foldDeadlineMs: recallBounds.foldDeadlineMs,
  pageBudgetMs: recallBounds.pageBudgetMs,
  mostViewBytes: recallBounds.mostViewBytes,
  worker: checkedWorker,
};

export const recallDefinitionType = 'recall';
