import { readYaml, type LocatedProblem, type Position, type YamlKind } from '@beonauto/config';
import { InvalidInput, type Issue } from '@beonauto/operations';
import {
  durationLimitRejections,
  type JsonObject,
  mostValueDepth,
  nestingRejections,
  type Rejection,
} from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import { dslProblems, type Problem } from './dsl-validation.ts';
import { workflowPolicy } from './workflow-functions.ts';

const thirtyDays = 2_592_000_000;

export type WorkflowDefinitionDocument = JsonObject;

export interface ReadWorkflow {
  readonly document: WorkflowDefinitionDocument;
  readonly locate: (pointer: string) => Position;
}

const workflowYaml: YamlKind = {
  noun: 'a workflow document',
  mapping: 'A workflow document is a YAML mapping, with document and do at its top',
  mostDepth: mostValueDepth,
  emptyIsMapping: false,
};

export interface LocatedIssue {
  readonly position: Position;
  readonly detail: string;
}

export const notRunnable = 'The workflow document is not a workflow this runtime runs';

export function readWorkflowDocument(
  source: string,
  mostDuration = thirtyDays,
): Effect.Effect<ReadWorkflow, InvalidInput> {
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
      ? Effect.succeed({ document: value, locate })
      : Effect.fail(invalidDocument(notRunnable, problems));
  });
}

export function parseWorkflowDocument(
  source: string,
  mostDuration = thirtyDays,
): Effect.Effect<WorkflowDefinitionDocument, InvalidInput> {
  return Effect.map(readWorkflowDocument(source, mostDuration), ({ document }) => document);
}

function isShadowed({ pointer }: Problem, rejections: readonly Rejection[]): boolean {
  return rejections.some(
    (rejection) =>
      rejection.pointer === pointer ||
      pointer.startsWith(`${rejection.pointer}/`) ||
      (pointer !== '' && rejection.pointer.startsWith(`${pointer}/`)),
  );
}

export function placeOf(pointer: string): string {
  return pointer === '' ? '' : `at ${pointer}: `;
}

export function invalidDocument(detail: string, problems: readonly (LocatedProblem | LocatedIssue)[]): InvalidInput {
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
