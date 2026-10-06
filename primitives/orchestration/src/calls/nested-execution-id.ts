import { uuidV5 } from '@beonauto/operations';

const nestedExecutions = '9b1f3a52-6c0d-4b8e-9f27-3e5d1c7a2b40';

export function nestedExecutionId(runId: string, reference: string, run: number): string {
  return uuidV5(nestedExecutions, `${runId}${reference}#${run}`);
}
