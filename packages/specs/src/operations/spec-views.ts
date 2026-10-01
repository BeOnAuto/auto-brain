import type { InvalidInput } from '@beonauto/operations';
import { Effect, Order, Struct } from 'effect';

import type { Primitive, SpecSummary } from '../primitive/primitive.ts';
import type { SpecContent } from '../registry/spec-events.ts';
import type { ListedSpec, Spec, StoredSpec } from '../registry/spec.ts';
import { refusalOfSource } from './issue-pointers.ts';

export const byName = Order.mapInput(Order.String, ({ name }: StoredSpec) => name);

export function specOf({ name, mediaType }: Primitive, stored: StoredSpec): Spec {
  return { primitive: name, media_type: mediaType, ...stored };
}

export function listedSpecOf(primitive: Primitive, stored: StoredSpec): ListedSpec {
  return Struct.omit(specOf(primitive, stored), ['source']);
}

function contentFrom(
  source: string,
  { description, inputSchema, outputSchema, warnings = [] }: SpecSummary,
): SpecContent {
  return {
    source,
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { input_schema: inputSchema }),
    ...(outputSchema === undefined ? {} : { output_schema: outputSchema }),
    ...(warnings.length === 0 ? {} : { warnings }),
  };
}

export function contentOf(primitive: Primitive, source: string): Effect.Effect<SpecContent, InvalidInput> {
  return primitive.prepare(source).pipe(
    Effect.mapError(refusalOfSource),
    Effect.map(({ summary }) => contentFrom(source, summary)),
  );
}
