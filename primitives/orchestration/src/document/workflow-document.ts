import { InvalidInput, type Issue } from '@beonauto/operations';
import { Effect } from 'effect';

import type { JsonObject } from '../dsl/json.ts';
import type { Refusal } from '../dsl/policy-checks.ts';
import { refusalsOf } from '../dsl/policy.ts';
import { dslProblems, type Problem } from './dsl-validation.ts';
import { readYaml, type LocatedProblem, type Position } from './yaml-reading.ts';

interface LocatedIssue {
  readonly position: Position;
  readonly detail: string;
}

export function parseWorkflowDocument(source: string): Effect.Effect<JsonObject, InvalidInput> {
  return Effect.suspend(() => {
    const reading = readYaml(source);
    if ('problems' in reading) {
      return Effect.fail(invalidDocument('The workflow document is not YAML this runtime reads', reading.problems));
    }
    const { value, locate } = reading.document;
    const refusals = refusalsOf(value);
    const versionRefused = refusals.some(({ pointer }) => pointer === '/document/dsl');
    const problems = [
      ...(versionRefused
        ? []
        : dslProblems(value, { connecting: refusals.length === 0 }).filter(
            (problem) => !isShadowed(problem, refusals),
          )),
      ...refusals,
    ].map(({ pointer, detail }) => ({ position: locate(pointer), detail: `${placeOf(pointer)}${detail}` }));
    return problems.length === 0
      ? Effect.succeed(value)
      : Effect.fail(invalidDocument('The workflow document is not a workflow this runtime runs', problems));
  });
}

function isShadowed({ pointer }: Problem, refusals: readonly Refusal[]): boolean {
  return refusals.some(
    (refusal) =>
      refusal.pointer === pointer ||
      pointer.startsWith(`${refusal.pointer}/`) ||
      (pointer !== '' && refusal.pointer.startsWith(`${pointer}/`)),
  );
}

function placeOf(pointer: string): string {
  return pointer === '' ? '' : `at ${pointer}: `;
}

function invalidDocument(detail: string, problems: readonly (LocatedProblem | LocatedIssue)[]): InvalidInput {
  const issues: readonly Issue[] = problems
    .toSorted((left, right) =>
      left.position.line === right.position.line
        ? left.position.column - right.position.column
        : left.position.line - right.position.line,
    )
    .map(({ position, detail: problem }) => ({
      detail: `Line ${position.line}, column ${position.column}: ${problem}`,
      pointer: '',
    }));
  return new InvalidInput({ detail, issues });
}
