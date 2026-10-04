import { readYaml, type LocatedProblem, type Position, type YamlKind } from '@beonauto/config';
import { InvalidInput, type Issue } from '@beonauto/operations';
import { durationLimitRejections } from '@beonauto/workflow-engine/dsl/duration-limits';
import { mostValueDepth, type JsonObject } from '@beonauto/workflow-engine/dsl/json';
import { nestingRejections } from '@beonauto/workflow-engine/dsl/nesting';
import type { Rejection } from '@beonauto/workflow-engine/dsl/policy-checks';
import { Effect } from 'effect';

import { defaultMostDuration } from '../interpreter/workflow-run.ts';
import { dslProblems, type Problem } from './dsl-validation.ts';
import { workflowPolicy } from './workflow-functions.ts';

const workflowYaml: YamlKind = {
  noun: 'a workflow document',
  mapping: 'A workflow document is a YAML mapping, with document and do at its top',
  mostDepth: mostValueDepth,
  emptyIsMapping: false,
};

interface LocatedIssue {
  readonly position: Position;
  readonly detail: string;
}

export function parseWorkflowDocument(
  source: string,
  mostDuration = defaultMostDuration,
): Effect.Effect<JsonObject, InvalidInput> {
  return Effect.suspend(() => {
    const reading = readYaml(source, workflowYaml);
    if ('problems' in reading) {
      return Effect.fail(invalidDocument('The workflow document is not YAML this runtime reads', reading.problems));
    }
    const { value, locate } = reading.document;
    const rejections = workflowPolicy(value);
    const unreadable =
      nestingRejections(value).length > 0 || rejections.some(({ pointer }) => pointer === '/document/dsl');
    const problems = [
      ...(unreadable
        ? []
        : dslProblems(value, { connecting: rejections.length === 0 }).filter(
            (problem) => !isShadowed(problem, rejections),
          )),
      ...rejections,
      ...(unreadable ? [] : durationLimitRejections(value, mostDuration)),
    ].map(({ pointer, detail }) => ({ position: locate(pointer), detail: `${placeOf(pointer)}${detail}` }));
    return problems.length === 0
      ? Effect.succeed(value)
      : Effect.fail(invalidDocument('The workflow document is not a workflow this runtime runs', problems));
  });
}

function isShadowed({ pointer }: Problem, rejections: readonly Rejection[]): boolean {
  return rejections.some(
    (rejection) =>
      rejection.pointer === pointer ||
      pointer.startsWith(`${rejection.pointer}/`) ||
      (pointer !== '' && rejection.pointer.startsWith(`${pointer}/`)),
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
