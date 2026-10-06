import { mostResultBytes } from '@beonauto/specs';
import { liftedLimits, mostEvaluationDepth, mostValueDepth, type ProgramLimits } from '@beonauto/workflow-engine/dsl';

export const computationBounds = {
  mostWork: 64_000_000,
  deadlineMs: 10_000,
  heapMegabytes: 256,
  workers: 4,
  mostValueDepth,
  mostEvaluationDepth,
} as const;

const recordRoomBytes = 256;

export const mostOutputBytes = mostResultBytes - recordRoomBytes;

export const computationLimits: ProgramLimits = liftedLimits(computationBounds.mostWork);
