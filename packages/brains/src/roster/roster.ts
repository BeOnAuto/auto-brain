import type { BrainCreated, BrainEvent, BrainRetired, BrainUpdated } from './brain-events.ts';
import type { Brain } from './brain.ts';

export type Roster = ReadonlyMap<string, Brain>;

export const emptyRoster: Roster = new Map();

function createdBrain({ brain, name, description, by, at }: BrainCreated): Brain {
  return { id: brain, name, description, status: 'active', created_at: at, created_by: by, updated_at: at };
}

function updatedBrain(brain: Brain, { name, description, at }: BrainUpdated): Brain {
  return { ...brain, name: name ?? brain.name, description: description ?? brain.description, updated_at: at };
}

function retiredBrain(brain: Brain, { at }: BrainRetired): Brain {
  return { ...brain, status: 'retired', updated_at: at, retired_at: at };
}

function withBrain(roster: Roster, brain: Brain): Roster {
  return new Map(roster).set(brain.id, brain);
}

export function evolveRoster(roster: Roster, event: BrainEvent): Roster {
  if (event.type === 'brain_created') {
    return withBrain(roster, createdBrain(event));
  }
  const brain = roster.get(event.brain);
  if (brain === undefined) {
    return roster;
  }
  return withBrain(roster, event.type === 'brain_updated' ? updatedBrain(brain, event) : retiredBrain(brain, event));
}
