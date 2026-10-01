export interface FailureRecorder {
  readonly onFailure: (detail: string) => void;
  readonly failures: () => readonly string[];
}

export function failureRecorder(): FailureRecorder {
  const failures: string[] = [];
  return {
    onFailure: (detail) => {
      failures.push(detail);
    },
    failures: () => failures,
  };
}
