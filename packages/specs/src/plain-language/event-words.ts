import { capitalized, explanationOf, plainNumber } from '@beonauto/operations';

import type { ExecutionRejection } from '../execution/execution.ts';
import { explainedRejectionOf } from './run-words.ts';
import type { SpecWords } from './spec-words.ts';

export const runCarriesOn = 'A run carries on by itself, and finishes later.';

export const runFinished = 'A run finished.';

export const runBrokeDown = 'A run broke down because of a problem inside the server.';

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
