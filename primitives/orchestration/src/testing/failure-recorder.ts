import type { UnsettledExecution } from '../worker/dependencies.ts';

export interface FailureRecorder {
  readonly onFailure: (detail: string) => void;
  readonly reportUnsettled: (execution: UnsettledExecution) => void;
  readonly failures: () => readonly string[];
  readonly unsettled: () => readonly UnsettledExecution[];
}

export function failureRecorder(): FailureRecorder {
  const failures: string[] = [];
  const unsettled: UnsettledExecution[] = [];
  return {
    onFailure: (detail) => {
      failures.push(detail);
    },
    reportUnsettled: (execution) => {
      unsettled.push(execution);
    },
    failures: () => failures,
    unsettled: () => unsettled,
  };
}
