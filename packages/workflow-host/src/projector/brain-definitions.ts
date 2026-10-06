import { SpecEventSchema, specsStreamOf, type SpecEvent } from '@beonauto/specs';
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

const decodeSpecEvent = Schema.decodeUnknownOption(Schema.toCodecJson(SpecEventSchema));

export function definitionStreamOf(brainKey: string, definitionType: string): string {
  return `${brainKey}${specsStreamOf(definitionType)}`;
}

export function brainKeyOfDefinitions(stream: string, definitionType: string): string {
  return stream.slice(0, stream.length - specsStreamOf(definitionType).length);
}

function evolved(functions: ReadonlyMap<string, KeptFunction>, event: SpecEvent, saved: number) {
  const kept = new Map(functions);
  if (event.type === 'spec_retired') {
    kept.delete(event.name);
  } else {
    kept.set(event.name, { version: event.version, saved, details: event.content.details });
  }
  return kept;
}

export function definitionsAfter(previous: BrainDefinitions, events: readonly unknown[]): BrainDefinitions {
  const functions = events.reduce<ReadonlyMap<string, KeptFunction>>(
    (kept, stored, index) =>
      Option.match(decodeSpecEvent(stored), {
        onNone: () => kept,
        onSome: (event) => evolved(kept, event, previous.version + index + 1),
      }),
    previous.functions,
  );
  return { version: previous.version + events.length, functions };
}
