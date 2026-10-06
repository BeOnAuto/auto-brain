import { capitalized, explanationOf, type ExplainedRejection, type PlainLanguage } from '@beonauto/operations';

import type { Run } from '../execution/execution.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { specWordsFor } from './spec-words.ts';

export type RunMoment = 'just started' | 'looked up';

type DescribedExecution = Pick<Run, 'primitive' | 'name' | 'status' | 'output' | 'rejection'>;

interface RunContext {
  readonly named: string;
  readonly primitive: Primitive | undefined;
  readonly moment: RunMoment;
}

interface SpecAddress {
  readonly primitive: string;
  readonly name: string;
}

const outputBeyondWords = 'Its result is in the details below.';

function describedOutput(primitive: Primitive | undefined, { output }: DescribedExecution): string {
  return primitive === undefined || output === undefined ? outputBeyondWords : primitive.describeOutput(output);
}

export function explainedRejectionOf(rejection: DescribedExecution['rejection']): ExplainedRejection {
  if (rejection === undefined || rejection.reason === 'conflict') {
    return { reason: 'conflict', kind: 'unworkable' };
  }
  if (rejection.reason !== 'unavailable' || rejection.kind === undefined) {
    return { reason: rejection.reason };
  }
  const { kind, because } = rejection;
  return because === undefined ? { reason: 'unavailable', kind } : { reason: 'unavailable', kind, because };
}

function rejectionWords({ named }: RunContext, { rejection }: DescribedExecution): string {
  const { why, remedy } = explanationOf(explainedRejectionOf(rejection));
  return `The run of ${named} did not go through: ${why}. ${remedy}`;
}

const wordsByStatus: Readonly<Record<Run['status'], (context: RunContext, execution: DescribedExecution) => string>> = {
  started: ({ named, moment }) =>
    moment === 'just started'
      ? `${capitalized(named)} has started and is still running. It carries on by itself, and how it ends can be looked up later.`
      : `${capitalized(named)} is still running; how it ends can be looked up again later.`,
  succeeded: ({ named, primitive, moment }, execution) =>
    `${moment === 'just started' ? `Ran ${named}.` : `The run of ${named} finished.`} ${describedOutput(primitive, execution)}`,
  rejected: rejectionWords,
  failed: ({ named }) =>
    `The run of ${named} broke down because of a problem inside the server; it was not caused by anything you did.`,
};

export function runWordsFor(
  primitives: readonly Primitive[],
): (execution: DescribedExecution, moment: RunMoment) => string {
  const words = specWordsFor(primitives);
  return (execution, moment) => {
    const named = words.named(execution.primitive, execution.name);
    const primitive = primitives.find(({ name }) => name === execution.primitive);
    return wordsByStatus[execution.status]({ named, primitive, moment }, execution);
  };
}

export function runPlainLanguage(primitives: readonly Primitive[]): PlainLanguage<SpecAddress, DescribedExecution> {
  const words = specWordsFor(primitives);
  const runWords = runWordsFor(primitives);
  return {
    task: `run a ${words.kinds}`,
    attempt: ({ primitive, name }) => `run ${words.named(primitive, name)}`,
    outcome: (execution) => runWords(execution, 'just started'),
  };
}
