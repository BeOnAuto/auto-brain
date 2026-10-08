import { answeredInWords } from '@beonauto/mcp';
import { capitalized, explanationOf, plainNumber, quoted } from '@beonauto/operations';

import type { CancelRequestKind, ToolCallAnswered } from '../execution/execution-events.ts';
import type { ExecutionRejection } from '../execution/execution.ts';
import { wordsOf } from './in-words.ts';
import { explainedRejectionOf } from './run-words.ts';
import type { SpecWords } from './spec-words.ts';

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

export function runStarted(words: SpecWords, primitive: string, name: string): string {
  return `A run of ${words.named(primitive, name)} started.`;
}

export function runRejected(rejection: ExecutionRejection): string {
  return `A run did not go through: ${explanationOf(explainedRejectionOf(rejection)).why}.`;
}

export function specCreated(words: SpecWords, primitive: string, name: string): string {
  return `${capitalized(words.named(primitive, name))} was created.`;
}

export function specUpdated(words: SpecWords, primitive: string, name: string, version: number): string {
  return `${capitalized(words.named(primitive, name))} was updated to version ${plainNumber(version)}.`;
}

export function specRetired(words: SpecWords, primitive: string, name: string): string {
  return `${capitalized(words.named(primitive, name))} was retired.`;
}

const notLettersOrDigits = /[^A-Za-z0-9]+/gu;

function nameInWords(name: string): string {
  return wordsOf(name.replaceAll(notLettersOrDigits, ' '));
}

export function toolCalled(number: number, server: string, tool: string): string {
  return `A run made tool call ${plainNumber(number)}, to the ${nameInWords(tool)} tool of ${nameInWords(server)}.`;
}

export function toolAnswered(number: number, outcome: ToolCallAnswered['outcome']): string {
  return `Tool call ${plainNumber(number)} ${answeredInWords[outcome]}.`;
}

export function eventPublished(type: string): string {
  return `The event ${quoted(type)} was published to the brain.`;
}

export function eventEmitted(type: string, workflow: string): string {
  return `The workflow ${quoted(workflow)} emitted the event ${quoted(type)}.`;
}

export function reactionsRefused(workflow: string): string {
  return `The workflow ${quoted(workflow)} was not started for everything its trigger matched in a minute; the details say how often and why.`;
}
