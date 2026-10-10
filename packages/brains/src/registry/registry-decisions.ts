import { Conflict, type Context, type Rejection } from '@beonauto/operations';
import { Result } from 'effect';

import type { BrainCommand, BrainCreation, BrainRetirement, BrainUpdate, CommandMetadata } from './brain-commands.ts';
import type { BrainEvent } from './brain-events.ts';
import type { Brain } from './brain.ts';
import { brainNotFound } from './registry-lookup.ts';
import type { Registry } from './registry.ts';

type Decision = Result.Result<readonly BrainEvent[], Rejection<'not_found' | 'conflict'>>;

const nothingToRecord: Decision = Result.succeed([]);

function recording(event: BrainEvent): Decision {
  return Result.succeed([event]);
}

function takenBy({ id, status }: Brain): Conflict {
  return new Conflict({
    detail:
      status === 'active'
        ? `There is already a brain ${id} in this org`
        : `The brain ${id} was retired, and a brain id is never reused`,
    kind: 'taken',
  });
}

function decideCreation({ brain, name, description }: BrainCreation, registry: Registry): Decision {
  const existing = registry.get(brain);
  return existing === undefined
    ? recording({ type: 'brain_created', data: { brain, name, description } })
    : Result.fail(takenBy(existing));
}

function decideUpdate({ brain, name, description }: BrainUpdate, registry: Registry): Decision {
  const existing = registry.get(brain);
  if (existing === undefined) {
    return Result.fail(brainNotFound(brain));
  }
  if (existing.status === 'retired') {
    return Result.fail(
      new Conflict({ detail: `The brain ${brain} is retired and can no longer change`, kind: 'retired' }),
    );
  }
  const renamed = name !== existing.name;
  const redescribed = description !== existing.description;
  if (!renamed && !redescribed) {
    return nothingToRecord;
  }
  return recording({
    type: 'brain_updated',
    data: { brain, ...(renamed ? { name } : {}), ...(redescribed ? { description } : {}) },
  });
}

function decideRetirement({ brain }: BrainRetirement, registry: Registry): Decision {
  const existing = registry.get(brain);
  if (existing === undefined) {
    return Result.fail(brainNotFound(brain));
  }
  return existing.status === 'retired' ? nothingToRecord : recording({ type: 'brain_retired', data: { brain } });
}

export function registryContextOf({ by, at }: CommandMetadata): Context {
  return { at, by };
}

export function decideOnRegistry(command: BrainCommand, registry: Registry): Decision {
  if (command.type === 'create') {
    return decideCreation(command, registry);
  }
  if (command.type === 'update') {
    return decideUpdate(command, registry);
  }
  return decideRetirement(command, registry);
}
