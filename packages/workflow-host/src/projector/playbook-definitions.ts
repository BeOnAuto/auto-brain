import { DefinitionEventSchema, definitionTypeStreamOf, type DefinitionEvent } from '@beonauto/definitions';
import { Option, Schema } from 'effect';

import { runnableDetailsOf } from '../views/view-details.ts';

export interface KeptFunction {
  readonly version: number;
  readonly saved: number;
  readonly details: unknown;
}

export interface PlaybookDefinitions {
  readonly version: number;
  readonly functions: ReadonlyMap<string, KeptFunction>;
}

export const noDefinitions: PlaybookDefinitions = { version: 0, functions: new Map() };

const decodeDefinitionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(DefinitionEventSchema));

export function definitionStreamOf(playbookKey: string, definitionType: string): string {
  return `${playbookKey}${definitionTypeStreamOf(definitionType)}`;
}

export function playbookKeyOfDefinitions(stream: string, definitionType: string): string {
  return stream.slice(0, stream.length - definitionTypeStreamOf(definitionType).length);
}

function evolved(functions: ReadonlyMap<string, KeptFunction>, event: DefinitionEvent, saved: number) {
  const kept = new Map(functions);
  if (event.type === 'definition_retired') {
    kept.delete(event.name);
  } else {
    kept.set(event.name, {
      version: event.version,
      saved,
      details: runnableDetailsOf(event.content.details, event.content.stripped),
    });
  }
  return kept;
}

export function definitionsAfter(previous: PlaybookDefinitions, events: readonly unknown[]): PlaybookDefinitions {
  const functions = events.reduce<ReadonlyMap<string, KeptFunction>>(
    (kept, stored, index) =>
      Option.match(decodeDefinitionEvent(stored), {
        onNone: () => kept,
        onSome: (event) => evolved(kept, event, previous.version + index + 1),
      }),
    previous.functions,
  );
  return { version: previous.version + events.length, functions };
}
