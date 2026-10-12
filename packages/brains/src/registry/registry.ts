import type { ActedContext } from '@beonauto/operations';

import type { PlaybookCreated, PlaybookUpdated, RecordedPlaybookEvent } from './brain-events.ts';
import type { Playbook } from './brain.ts';

export type Registry = ReadonlyMap<string, Playbook>;

export const initialRegistry: Registry = new Map();

function createdPlaybook({ data, context }: PlaybookCreated): Playbook {
  const { brain: playbook, name, description } = data;
  const { at, by } = context;
  return { id: playbook, name, description, status: 'active', created_at: at, created_by: by, updated_at: at };
}

function updatedPlaybook(playbook: Playbook, { data, context }: PlaybookUpdated): Playbook {
  const { name = playbook.name, description = playbook.description } = data;
  return { ...playbook, name, description, updated_at: context.at };
}

function retiredPlaybook(playbook: Playbook, { at }: ActedContext): Playbook {
  return { ...playbook, status: 'retired', updated_at: at, retired_at: at };
}

function withPlaybook(registry: Registry, playbook: Playbook): Registry {
  return new Map(registry).set(playbook.id, playbook);
}

export function evolveRegistry(registry: Registry, event: RecordedPlaybookEvent): Registry {
  if (event.type === 'brain_created') {
    return withPlaybook(registry, createdPlaybook(event));
  }
  const playbook = registry.get(event.data.brain);
  if (playbook === undefined) {
    return registry;
  }
  return withPlaybook(
    registry,
    event.type === 'brain_updated' ? updatedPlaybook(playbook, event) : retiredPlaybook(playbook, event.context),
  );
}
