import type { BrainCreated, BrainEvent, BrainRetired, BrainUpdated } from './brain-events.ts';
import type { Brain } from './brain.ts';

export type Registry = ReadonlyMap<string, Brain>;

export const emptyRegistry: Registry = new Map();

function createdBrain({ brain, name, description, by, at }: BrainCreated): Brain {
  return { id: brain, name, description, status: 'active', created_at: at, created_by: by, updated_at: at };
}

function updatedBrain(brain: Brain, { name, description, at }: BrainUpdated): Brain {
  return { ...brain, name: name ?? brain.name, description: description ?? brain.description, updated_at: at };
}

function retiredBrain(brain: Brain, { at }: BrainRetired): Brain {
  return { ...brain, status: 'retired', updated_at: at, retired_at: at };
}

function withBrain(registry: Registry, brain: Brain): Registry {
  return new Map(registry).set(brain.id, brain);
}

export function evolveRegistry(registry: Registry, event: BrainEvent): Registry {
  if (event.type === 'brain_created') {
    return withBrain(registry, createdBrain(event));
  }
  const brain = registry.get(event.brain);
  if (brain === undefined) {
    return registry;
  }
  return withBrain(registry, event.type === 'brain_updated' ? updatedBrain(brain, event) : retiredBrain(brain, event));
}
