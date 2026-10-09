import { DefinitionEventSchema, definitionTypeStreamOf, type DefinitionEvent } from '@beonauto/definitions';
import { Option, Schema } from 'effect';

export interface KeptFunction {
  readonly version: number;
  readonly saved: number;
  readonly details: unknown;
}

export interface BrainDefinitions {
  readonly version: number;
  readonly functions: ReadonlyMap<string, KeptFunction>;
}

export const noDefinitions: BrainDefinitions = { version: 0, functions: new Map() };

const decodeDefinitionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(DefinitionEventSchema));

export function definitionStreamOf(brainKey: string, definitionType: string): string {
  return `${brainKey}${definitionTypeStreamOf(definitionType)}`;
}

export function brainKeyOfDefinitions(stream: string, definitionType: string): string {
  return stream.slice(0, stream.length - definitionTypeStreamOf(definitionType).length);
}

function evolved(functions: ReadonlyMap<string, KeptFunction>, event: DefinitionEvent, saved: number) {
  const kept = new Map(functions);
  if (event.type === 'definition_retired') {
    kept.delete(event.name);
  } else {
    kept.set(event.name, { version: event.version, saved, details: event.content.details });
  }
  return kept;
}

export function definitionsAfter(previous: BrainDefinitions, events: readonly unknown[]): BrainDefinitions {
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
