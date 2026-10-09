import type { InvalidInput } from '@beonauto/operations';
import { Effect, Order, Struct } from 'effect';

import type { Capability, DefinitionSummary } from '../capability/capability.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { ListedDefinition, Definition, StoredDefinition } from '../registry/definition.ts';
import { rejectionOfSource } from './issue-pointers.ts';

export const byName = Order.mapInput(Order.String, ({ name }: StoredDefinition) => name);

export function definitionOf({ type, mediaType }: Capability, stored: StoredDefinition): Definition {
  return { type, media_type: mediaType, ...Struct.omit(stored, ['details']) };
}

export function listedDefinitionOf(capability: Capability, stored: StoredDefinition): ListedDefinition {
  return Struct.omit(definitionOf(capability, stored), ['source']);
}

function contentFrom(
  source: string,
  { description, inputSchema, outputSchema, warnings = [], triggers = [], details }: DefinitionSummary,
): DefinitionContent {
  return {
    source,
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { input_schema: inputSchema }),
    ...(outputSchema === undefined ? {} : { output_schema: outputSchema }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(triggers.length === 0 ? {} : { triggers }),
    ...(details === undefined ? {} : { details }),
  };
}

export function contentOf(capability: Capability, source: string): Effect.Effect<DefinitionContent, InvalidInput> {
  return capability.prepare(source).pipe(
    Effect.mapError(rejectionOfSource),
    Effect.map(({ summary }) => contentFrom(source, summary)),
  );
}
