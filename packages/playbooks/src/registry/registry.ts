import type { PlaybookCreated, PlaybookEvent, PlaybookRetired, PlaybookUpdated } from './playbook-events.ts';
import type { Playbook } from './playbook.ts';

export type Registry = ReadonlyMap<string, Playbook>;

export const initialRegistry: Registry = new Map();

function createdPlaybook({ playbook, name, description, by, at }: PlaybookCreated): Playbook {
  return { id: playbook, name, description, status: 'active', created_at: at, created_by: by, updated_at: at };
}

function updatedPlaybook(playbook: Playbook, { name, description, at }: PlaybookUpdated): Playbook {
  return { ...playbook, name: name ?? playbook.name, description: description ?? playbook.description, updated_at: at };
}

function retiredPlaybook(playbook: Playbook, { at }: PlaybookRetired): Playbook {
  return { ...playbook, status: 'retired', updated_at: at, retired_at: at };
}

function withPlaybook(registry: Registry, playbook: Playbook): Registry {
  return new Map(registry).set(playbook.id, playbook);
}

export function evolveRegistry(registry: Registry, event: PlaybookEvent): Registry {
  if (event.type === 'playbook_created') {
    return withPlaybook(registry, createdPlaybook(event));
  }
  const playbook = registry.get(event.playbook);
  if (playbook === undefined) {
    return registry;
  }
  return withPlaybook(
    registry,
    event.type === 'playbook_updated' ? updatedPlaybook(playbook, event) : retiredPlaybook(playbook, event),
  );
}
