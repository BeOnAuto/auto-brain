import { capitalized, explanationOf, type ExplainedRejection, type PlainLanguage } from '@beonauto/operations';

import type { Capability } from '../capability/capability.ts';
import type { Run } from '../runs/run.ts';
import { definitionWordsFor } from './definition-words.ts';

export type RunMoment = 'just started' | 'looked up';

type DescribedRun = Pick<Run, 'type' | 'name' | 'status' | 'output' | 'rejection'>;

interface RunContext {
  readonly named: string;
  readonly capability: Capability | undefined;
  readonly moment: RunMoment;
}

interface DefinitionAddress {
  readonly type: string;
  readonly name: string;
}

const outputBeyondWords = 'Its result is in the details below.';

function describedOutput(capability: Capability | undefined, { output }: DescribedRun): string {
  return capability === undefined || output === undefined ? outputBeyondWords : capability.describeOutput(output);
}

export function explainedRejectionOf(rejection: DescribedRun['rejection']): ExplainedRejection {
  if (rejection === undefined) {
    return { reason: 'conflict', kind: 'unworkable' };
  }
  if (rejection.reason === 'conflict') {
    const { kind } = rejection;
    return kind === undefined ? { reason: 'conflict' } : { reason: 'conflict', kind };
  }
  if (rejection.reason === 'cancelled' || rejection.reason === 'unanswered') {
    return { reason: rejection.reason, kind: rejection.kind };
  }
  if (rejection.reason !== 'unavailable' || rejection.kind === undefined) {
    return { reason: rejection.reason };
  }
  const { kind, because } = rejection;
  return because === undefined ? { reason: 'unavailable', kind } : { reason: 'unavailable', kind, because };
}

function rejectionWords({ named }: RunContext, { rejection }: DescribedRun): string {
  const { why, remedy } = explanationOf(explainedRejectionOf(rejection));
  return `The run of ${named} did not go through: ${why}. ${remedy}`;
}

const wordsByStatus: Readonly<Record<Run['status'], (context: RunContext, run: DescribedRun) => string>> = {
  started: ({ named, moment }) =>
    moment === 'just started'
      ? `${capitalized(named)} has started and is still running. It carries on by itself, and how it ends can be looked up later.`
      : `${capitalized(named)} is still running; how it ends can be looked up again later.`,
  succeeded: ({ named, capability, moment }, run) =>
    `${moment === 'just started' ? `Ran ${named}.` : `The run of ${named} finished.`} ${describedOutput(capability, run)}`,
  rejected: rejectionWords,
  failed: ({ named }) =>
    `The run of ${named} broke down because of a problem inside the server; it was not caused by anything you did.`,
};

export function runWordsFor(capabilities: readonly Capability[]): (run: DescribedRun, moment: RunMoment) => string {
  const words = definitionWordsFor(capabilities);
  return (run, moment) => {
    const named = words.named(run.type, run.name);
    const capability = capabilities.find(({ type }) => type === run.type);
    return wordsByStatus[run.status]({ named, capability, moment }, run);
  };
}

export function runPlainLanguage(capabilities: readonly Capability[]): PlainLanguage<DefinitionAddress, DescribedRun> {
  const words = definitionWordsFor(capabilities);
  const runWords = runWordsFor(capabilities);
  return {
    task: `run a ${words.kinds}`,
    attempt: ({ type, name }) => `run ${words.named(type, name)}`,
    outcome: (run) => runWords(run, 'just started'),
  };
}
