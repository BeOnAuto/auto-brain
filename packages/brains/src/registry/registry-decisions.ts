import { Conflict, type Context, type Rejection } from '@beonauto/operations';
import { Result } from 'effect';

import type {
  PlaybookCommand,
  PlaybookCreation,
  PlaybookRetirement,
  PlaybookUpdate,
  CommandMetadata,
} from './brain-commands.ts';
import type { PlaybookEvent } from './brain-events.ts';
import type { Playbook } from './brain.ts';
import { playbookNotFound } from './registry-lookup.ts';
import type { Registry } from './registry.ts';

type Decision = Result.Result<readonly PlaybookEvent[], Rejection<'not_found' | 'conflict'>>;

const nothingToRecord: Decision = Result.succeed([]);

function recording(event: PlaybookEvent): Decision {
  return Result.succeed([event]);
}

function takenBy({ id, status }: Playbook): Conflict {
  return new Conflict({
    detail:
      status === 'active'
        ? `There is already a playbook ${id} in this org`
        : `The playbook ${id} was retired, and a playbook id is never reused`,
    kind: 'taken',
  });
}

function decideCreation({ playbook, name, description }: PlaybookCreation, registry: Registry): Decision {
  const existing = registry.get(playbook);
  return existing === undefined
    ? recording({ type: 'brain_created', data: { brain: playbook, name, description } })
    : Result.fail(takenBy(existing));
}

function decideUpdate({ playbook, name, description }: PlaybookUpdate, registry: Registry): Decision {
  const existing = registry.get(playbook);
  if (existing === undefined) {
    return Result.fail(playbookNotFound(playbook));
  }
  if (existing.status === 'retired') {
    return Result.fail(
      new Conflict({ detail: `The playbook ${playbook} is retired and can no longer change`, kind: 'retired' }),
    );
  }
  const renamed = name !== existing.name;
  const redescribed = description !== existing.description;
  if (!renamed && !redescribed) {
    return nothingToRecord;
  }
  return recording({
    type: 'brain_updated',
    data: { brain: playbook, ...(renamed ? { name } : {}), ...(redescribed ? { description } : {}) },
  });
}

function decideRetirement({ playbook }: PlaybookRetirement, registry: Registry): Decision {
  const existing = registry.get(playbook);
  if (existing === undefined) {
    return Result.fail(playbookNotFound(playbook));
  }
  return existing.status === 'retired'
    ? nothingToRecord
    : recording({ type: 'brain_retired', data: { brain: playbook } });
}

export function registryContextOf({ by, at }: CommandMetadata): Context {
  return { at, by };
}

export function decideOnRegistry(command: PlaybookCommand, registry: Registry): Decision {
  if (command.type === 'create') {
    return decideCreation(command, registry);
  }
  if (command.type === 'update') {
    return decideUpdate(command, registry);
  }
  return decideRetirement(command, registry);
}
