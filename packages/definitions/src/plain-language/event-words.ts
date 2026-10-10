import { answeredInWords, failedInWords, toolInWords, type CallFailedBecause } from '@beonauto/mcp';
import { capitalized, explanationOf, plainNumber, quoted } from '@beonauto/operations';

import type { StartingTrigger } from '../registry/definition-triggers.ts';
import type { CancelRequestKind } from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import type { DefinitionWords } from './definition-words.ts';
import { explainedRejectionOf } from './run-words.ts';

export const runFinished = 'A run finished.';

export const runBrokeDown = 'A run broke down because of a problem inside the server.';

const cancelsAsked: Readonly<Record<CancelRequestKind, string>> = {
  requested: 'Someone allowed to change the brain asked for the run to be cancelled.',
  deadline: 'The step that waited for the run ran out of time, so the run is being cancelled.',
  parent_ended: 'The run that waited for this run ended first, so this run is being cancelled.',
};

export function cancelAsked(kind: CancelRequestKind): string {
  return cancelsAsked[kind];
}

const triggerNames: Readonly<Record<StartingTrigger['kind'], string>> = {
  event: 'event trigger',
  cron: 'cron schedule',
  every: 'every schedule',
};

export function triggerNamed(kind: StartingTrigger['kind']): string {
  return triggerNames[kind];
}

export function runStarted(words: DefinitionWords, type: string, name: string, trigger?: StartingTrigger): string {
  return trigger === undefined
    ? `A run of ${words.named(type, name)} started.`
    : `A run of ${words.named(type, name)} was started by its ${triggerNamed(trigger.kind)}.`;
}

export function runRejected(rejection: RunRejection): string {
  return `A run did not go through: ${explanationOf(explainedRejectionOf(rejection)).why}.`;
}

export function definitionCreated(words: DefinitionWords, type: string, name: string): string {
  return `${capitalized(words.named(type, name))} was created.`;
}

export function definitionUpdated(words: DefinitionWords, type: string, name: string, version: number): string {
  return `${capitalized(words.named(type, name))} was updated to version ${plainNumber(version)}.`;
}

export function definitionRetired(words: DefinitionWords, type: string, name: string): string {
  return `${capitalized(words.named(type, name))} was retired.`;
}

export function toolCalled(number: number, server: string, tool: string): string {
  return `A run made tool call ${plainNumber(number)}, to ${toolInWords({ server, tool })}.`;
}

export function toolAnswered(number: number, isError: boolean): string {
  return `Tool call ${plainNumber(number)} ${answeredInWords(isError)}.`;
}

export function toolFailed(number: number, because: CallFailedBecause): string {
  return `Tool call ${plainNumber(number)} ${failedInWords[because]}.`;
}

export function eventPublished(type: string): string {
  return `The event ${quoted(type)} was published to the brain.`;
}

export function eventEmitted(type: string, workflow: string): string {
  return `The workflow ${quoted(workflow)} emitted the event ${quoted(type)}.`;
}

export function reactionsRefused(workflow: string): string {
  return `The workflow ${quoted(workflow)} was not started every time its triggers called for it in a minute; the details say how often and why.`;
}
