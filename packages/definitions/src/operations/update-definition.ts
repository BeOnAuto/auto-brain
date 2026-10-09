import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor, whatItDoes } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { SourceField, DefinitionNameField } from './definition-fields.ts';
import { contentOf, definitionOf } from './definition-views.ts';
import { recordInRegistry } from './registry-access.ts';

export function defineUpdateDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('brain', {
      name: 'update_definition',
      title: 'Update definition',
      description: [
        'Replaces the whole document of an active function or workflow definition and returns its new version, which every run uses from then on.',
        'Use it when the person changes a saved definition; create_definition saves a new one, and a retired definition cannot change.',
        "`type` and `name` say which definition, and `source` is the whole new document in its type's format, which get_guide gives.",
        'A document that does not fit its format is refused with the line and what is wrong, and one the same as the saved document records nothing.',
        "A new version of a recall function builds its view again from the brain's history.",
      ].join(' '),
      repeatable: true,
      route: { method: 'PUT', path: '/definitions/{type}/{name}' },
      inputSchema: Schema.Struct({ type: known.field, name: DefinitionNameField, source: SourceField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ type, name, source }) {
        const capability = yield* known.capabilityOfType(type);
        const content = yield* contentOf(capability, source);
        return definitionOf(capability, yield* recordInRegistry(capability, { type: 'update', name, content }));
      }),
      plainLanguage: {
        task: `update a ${words.kinds}`,
        attempt: ({ type, name }) => `update ${words.named(type, name)}`,
        outcome: (definition) =>
          `Updated ${words.named(definition.type, definition.name)}.${whatItDoes(definition)} The change applies from its next run.`,
      },
    }),
  );
}
