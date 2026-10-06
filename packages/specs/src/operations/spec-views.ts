import type { InvalidInput } from '@beonauto/operations';
import { Effect, Order, Struct } from 'effect';

import type { Primitive, DefinitionSummary } from '../primitive/primitive.ts';
import type { SpecContent } from '../registry/spec-events.ts';
import type { ListedDefinition, Definition, StoredDefinition } from '../registry/spec.ts';
import { rejectionOfSource } from './issue-pointers.ts';

export const byName = Order.mapInput(Order.String, ({ name }: StoredDefinition) => name);

export function specOf({ name, mediaType }: Primitive, stored: StoredDefinition): Definition {
  return { primitive: name, media_type: mediaType, ...Struct.omit(stored, ['details']) };
}

export function listedSpecOf(primitive: Primitive, stored: StoredDefinition): ListedDefinition {
  return Struct.omit(specOf(primitive, stored), ['source']);
}

function contentFrom(
  source: string,
  { description, inputSchema, outputSchema, warnings = [], reacts = false, details }: DefinitionSummary,
): SpecContent {
  return {
    source,
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { input_schema: inputSchema }),
    ...(outputSchema === undefined ? {} : { output_schema: outputSchema }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(reacts ? { reacts } : {}),
    ...(details === undefined ? {} : { details }),
  };
}

export function contentOf(primitive: Primitive, source: string): Effect.Effect<SpecContent, InvalidInput> {
  return primitive.prepare(source).pipe(
    Effect.mapError(rejectionOfSource),
    Effect.map(({ summary }) => contentFrom(source, summary)),
  );
}
