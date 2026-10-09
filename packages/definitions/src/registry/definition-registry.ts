import type { DefinitionCreated, DefinitionEvent, DefinitionRetired, DefinitionUpdated } from './definition-events.ts';
import type { StoredDefinition } from './definition.ts';

export type DefinitionRegistry = ReadonlyMap<string, StoredDefinition>;

export const initialRegistry: DefinitionRegistry = new Map();

function createdDefinition({ name, version, content, by, at }: DefinitionCreated): StoredDefinition {
  return { name, version, status: 'active', ...content, created_at: at, created_by: by, updated_at: at };
}

function updatedDefinition(
  { name, status, created_at, created_by }: StoredDefinition,
  { version, content, at }: DefinitionUpdated,
): StoredDefinition {
  return { name, version, status, ...content, created_at, created_by, updated_at: at };
}

function retiredDefinition(definition: StoredDefinition, { at }: DefinitionRetired): StoredDefinition {
  return { ...definition, status: 'retired', updated_at: at, retired_at: at };
}

function withDefinition(registry: DefinitionRegistry, definition: StoredDefinition): DefinitionRegistry {
  return new Map(registry).set(definition.name, definition);
}

export function evolveRegistry(registry: DefinitionRegistry, event: DefinitionEvent): DefinitionRegistry {
  if (event.type === 'definition_created') {
    return withDefinition(registry, createdDefinition(event));
  }
  const definition = registry.get(event.name);
  if (definition === undefined) {
    return registry;
  }
  return withDefinition(
    registry,
    event.type === 'definition_updated' ? updatedDefinition(definition, event) : retiredDefinition(definition, event),
  );
}
