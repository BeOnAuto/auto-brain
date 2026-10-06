import type { SpecCreated, SpecEvent, SpecRetired, SpecUpdated } from './spec-events.ts';
import type { StoredDefinition } from './spec.ts';

export type SpecRegistry = ReadonlyMap<string, StoredDefinition>;

export const initialRegistry: SpecRegistry = new Map();

function createdSpec({ name, version, content, by, at }: SpecCreated): StoredDefinition {
  return { name, version, status: 'active', ...content, created_at: at, created_by: by, updated_at: at };
}

function updatedSpec(
  { name, status, created_at, created_by }: StoredDefinition,
  { version, content, at }: SpecUpdated,
): StoredDefinition {
  return { name, version, status, ...content, created_at, created_by, updated_at: at };
}

function retiredSpec(spec: StoredDefinition, { at }: SpecRetired): StoredDefinition {
  return { ...spec, status: 'retired', updated_at: at, retired_at: at };
}

function withSpec(registry: SpecRegistry, spec: StoredDefinition): SpecRegistry {
  return new Map(registry).set(spec.name, spec);
}

export function evolveRegistry(registry: SpecRegistry, event: SpecEvent): SpecRegistry {
  if (event.type === 'spec_created') {
    return withSpec(registry, createdSpec(event));
  }
  const spec = registry.get(event.name);
  if (spec === undefined) {
    return registry;
  }
  return withSpec(registry, event.type === 'spec_updated' ? updatedSpec(spec, event) : retiredSpec(spec, event));
}
