import type { ActedContext } from '@beonauto/operations';

import type { BrainCreated, BrainUpdated, RecordedBrainEvent } from './brain-events.ts';
import type { Brain } from './brain.ts';

export type Registry = ReadonlyMap<string, Brain>;

export const initialRegistry: Registry = new Map();

function createdBrain({ data, context }: BrainCreated): Brain {
  const { brain, name, description } = data;
  const { at, by } = context;
  return { id: brain, name, description, status: 'active', created_at: at, created_by: by, updated_at: at };
}

function updatedBrain(brain: Brain, { data, context }: BrainUpdated): Brain {
  const { name = brain.name, description = brain.description } = data;
  return { ...brain, name, description, updated_at: context.at };
}

function retiredBrain(brain: Brain, { at }: ActedContext): Brain {
  return { ...brain, status: 'retired', updated_at: at, retired_at: at };
}

function withBrain(registry: Registry, brain: Brain): Registry {
  return new Map(registry).set(brain.id, brain);
}

export function evolveRegistry(registry: Registry, event: RecordedBrainEvent): Registry {
  if (event.type === 'brain_created') {
    return withBrain(registry, createdBrain(event));
  }
  const brain = registry.get(event.data.brain);
  if (brain === undefined) {
    return registry;
  }
  return withBrain(
    registry,
    event.type === 'brain_updated' ? updatedBrain(brain, event) : retiredBrain(brain, event.context),
  );
}
