import type { SpecCreated, SpecEvent, SpecRetired, SpecUpdated } from './spec-events.ts';
import type { StoredSpec } from './spec.ts';

export type SpecRegistry = ReadonlyMap<string, StoredSpec>;

export const initialRegistry: SpecRegistry = new Map();

function createdSpec({ name, version, content, by, at }: SpecCreated): StoredSpec {
  return { name, version, status: 'active', ...content, created_at: at, created_by: by, updated_at: at };
}

function updatedSpec(
  { name, status, created_at, created_by }: StoredSpec,
  { version, content, at }: SpecUpdated,
): StoredSpec {
  return { name, version, status, ...content, created_at, created_by, updated_at: at };
}

function retiredSpec(spec: StoredSpec, { at }: SpecRetired): StoredSpec {
  return { ...spec, status: 'retired', updated_at: at, retired_at: at };
}

function withSpec(registry: SpecRegistry, spec: StoredSpec): SpecRegistry {
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
