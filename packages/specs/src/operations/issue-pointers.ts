import { InvalidInput, type Issue } from '@beonauto/operations';

export interface Refusal {
  readonly detail: string;
  readonly issues: readonly Issue[];
}

export function issuesUnder(field: string, issues: readonly Issue[]): readonly Issue[] {
  return issues.map(({ detail, pointer }) => ({ detail, pointer: `/${field}${pointer}` }));
}

export function refusalOfSource({ detail, issues }: Refusal): InvalidInput {
  return new InvalidInput({ detail, issues: issuesUnder('source', issues) });
}
