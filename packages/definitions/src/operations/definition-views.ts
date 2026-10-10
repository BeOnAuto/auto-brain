import type { InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect, Order, Struct } from 'effect';

import type { Capability, DefinitionSummary } from '../capability/capability.ts';
import type { StrippedForms } from '../capability/stripped-forms.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { ListedDefinition, Definition, StoredDefinition } from '../registry/definition.ts';
import { rejectionOfSource, type Rejection } from './issue-pointers.ts';

export const byName = Order.mapInput(Order.String, ({ name }: StoredDefinition) => name);

export function definitionOf({ type, mediaType }: Capability, stored: StoredDefinition): Definition {
  return { type, media_type: mediaType, ...Struct.omit(stored, ['details', 'stripped']) };
}

export function listedDefinitionOf(capability: Capability, stored: StoredDefinition): ListedDefinition {
  return Struct.omit(definitionOf(capability, stored), ['source']);
}

function contentFrom(
  source: string,
  { description, inputSchema, outputSchema, warnings = [], triggers = [], details }: DefinitionSummary,
  stripped: StrippedForms,
): DefinitionContent {
  return {
    source,
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { input_schema: inputSchema }),
    ...(outputSchema === undefined ? {} : { output_schema: outputSchema }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(triggers.length === 0 ? {} : { triggers }),
    ...(details === undefined ? {} : { details }),
    ...(Object.keys(stripped).length === 0 ? {} : { stripped }),
  };
}

function refusedSource(rejection: Rejection): Effect.Effect<never, InvalidInput> {
  return Effect.fail(rejectionOfSource(rejection));
}

export function contentOf(
  capability: Capability,
  source: string,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable> {
  return capability.prepare(source).pipe(
    Effect.flatMap(({ summary, check }) => Effect.map(check, (stripped) => contentFrom(source, summary, stripped))),
    Effect.catchTag('invalid_input', refusedSource),
  );
}
