import { uuidV5 } from '@beonauto/operations';

import type { StepKey } from './step-entry.ts';

const stepEvents = '1e08cd36-b0d0-4ce3-bd92-cd36f7e6c276';

export function stepEventIdOf(executionId: string, { reference, run, outcome, times }: StepKey): string {
  return uuidV5(stepEvents, JSON.stringify([executionId, reference, run, outcome, times]));
}
