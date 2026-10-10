import type { Context, Recorded } from '@beonauto/operations';

import type { DefinitionCreated, DefinitionEvent, DefinitionUpdated } from './definition-events.ts';
import type { StoredDefinition } from './definition.ts';

export type DefinitionRegistry = ReadonlyMap<string, StoredDefinition>;

export const initialRegistry: DefinitionRegistry = new Map();

export function definitionNameOf({ definitionName }: Context): string {
  return definitionName ?? '';
}

function createdDefinition({ data, context }: Recorded<DefinitionCreated>): StoredDefinition {
  const { at, by, definitionVersion: version = 1 } = context;
  const name = definitionNameOf(context);
  return { name, version, status: 'active', ...data.content, created_at: at, created_by: by, updated_at: at };
}

function updatedDefinition(
  { name, version: earlier, status, created_at, created_by }: StoredDefinition,
  { data, context }: Recorded<DefinitionUpdated>,
): StoredDefinition {
  const { at, definitionVersion: version = earlier + 1 } = context;
  return { name, version, status, ...data.content, created_at, created_by, updated_at: at };
}

function retiredDefinition(definition: StoredDefinition, { at }: Context): StoredDefinition {
  return { ...definition, status: 'retired', updated_at: at, retired_at: at };
}

function withDefinition(registry: DefinitionRegistry, definition: StoredDefinition): DefinitionRegistry {
  return new Map(registry).set(definition.name, definition);
}

export function evolveRegistry(registry: DefinitionRegistry, event: Recorded<DefinitionEvent>): DefinitionRegistry {
  if (event.type === 'definition_created') {
    return withDefinition(registry, createdDefinition(event));
  }
  const definition = registry.get(definitionNameOf(event.context));
  if (definition === undefined) {
    return registry;
  }
  return withDefinition(
    registry,
    event.type === 'definition_updated'
      ? updatedDefinition(definition, event)
      : retiredDefinition(definition, event.context),
  );
}
