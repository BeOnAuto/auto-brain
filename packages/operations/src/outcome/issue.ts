export interface Issue {
  readonly detail: string;
  readonly pointer: string;
}

const mostIssues = 100;

export function cappedIssues(issues: readonly Issue[]): readonly Issue[] {
  return issues.slice(0, mostIssues).map(({ detail, pointer }) => ({ detail, pointer }));
}
