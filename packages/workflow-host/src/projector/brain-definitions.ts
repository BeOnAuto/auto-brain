import {
  DefinitionEventSchema,
  definitionTypeStreamOf,
  type RecordedDefinitionEvent,
  type StrippedForms,
} from '@beonauto/definitions';
import { recordedDecoder } from '@beonauto/operations';
import { Option } from 'effect';

export interface KeptFunction {
  readonly version: number;
  readonly saved: number;
  readonly details: unknown;
}

export interface BrainDefinitions {
  readonly version: number;
  readonly functions: ReadonlyMap<string, KeptFunction>;
}

export type KeptOf = (details: unknown, stripped?: StrippedForms) => unknown;

export const noDefinitions: BrainDefinitions = { version: 0, functions: new Map() };

const decodeDefinitionEvent = recordedDecoder(DefinitionEventSchema);

export function definitionStreamOf(brainKey: string, definitionType: string): string {
  return `${brainKey}${definitionTypeStreamOf(definitionType)}`;
}

export function brainKeyOfDefinitions(stream: string, definitionType: string): string {
  return stream.slice(0, stream.length - definitionTypeStreamOf(definitionType).length);
}

function evolved(
  functions: ReadonlyMap<string, KeptFunction>,
  event: RecordedDefinitionEvent,
  saved: number,
  keptOf: KeptOf,
) {
  const kept = new Map(functions);
  const { definitionName: name, definitionVersion: version } = event.context;
  if (event.type === 'definition_retired') {
    kept.delete(name);
  } else {
    const { content } = event.data;
    kept.set(name, { version, saved, details: keptOf(content.details, content.stripped) });
  }
  return kept;
}

export function definitionsAfter(
  previous: BrainDefinitions,
  events: readonly unknown[],
  keptOf: KeptOf,
): BrainDefinitions {
  const functions = events.reduce<ReadonlyMap<string, KeptFunction>>(
    (kept, stored, index) =>
      Option.match(decodeDefinitionEvent(stored), {
        onNone: () => kept,
        onSome: (event) => evolved(kept, event, previous.version + index + 1, keptOf),
      }),
    previous.functions,
  );
  return { version: previous.version + events.length, functions };
}
