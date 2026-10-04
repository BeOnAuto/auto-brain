import { Conflict, type Rejection } from '@beonauto/operations';
import { Result } from 'effect';

import { specNotFound } from './registry-lookup.ts';
import type { CommandMetadata, SpecCommand, SpecCreation, SpecRetirement, SpecUpdate } from './spec-commands.ts';
import type { SpecEvent } from './spec-events.ts';
import type { SpecRegistry } from './spec-registry.ts';
import type { StoredSpec } from './spec.ts';

type Decision = Result.Result<readonly SpecEvent[], Rejection<'not_found' | 'conflict'>>;

const nothingToRecord: Decision = Result.succeed([]);

function recording(event: SpecEvent): Decision {
  return Result.succeed([event]);
}

function takenBy(primitive: string, { name, status }: StoredSpec): Conflict {
  return new Conflict({
    detail:
      status === 'active'
        ? `The brain already has the ${primitive} spec ${name}`
        : `The ${primitive} spec ${name} was retired, and a spec name is never reused`,
    kind: 'taken',
  });
}

function decideCreation(
  primitive: string,
  { name, content, by, at }: SpecCreation & CommandMetadata,
  registry: SpecRegistry,
): Decision {
  const existing = registry.get(name);
  return existing === undefined
    ? recording({ type: 'spec_created', name, version: 1, content, by, at })
    : Result.fail(takenBy(primitive, existing));
}

function decideUpdate(
  primitive: string,
  { name, content, by, at }: SpecUpdate & CommandMetadata,
  registry: SpecRegistry,
): Decision {
  const existing = registry.get(name);
  if (existing === undefined) {
    return Result.fail(specNotFound(primitive, name));
  }
  if (existing.status === 'retired') {
    return Result.fail(
      new Conflict({ detail: `The ${primitive} spec ${name} is retired and can no longer change`, kind: 'retired' }),
    );
  }
  return existing.source === content.source
    ? nothingToRecord
    : recording({ type: 'spec_updated', name, version: existing.version + 1, content, by, at });
}

function decideRetirement(
  primitive: string,
  { name, by, at }: SpecRetirement & CommandMetadata,
  registry: SpecRegistry,
): Decision {
  const existing = registry.get(name);
  if (existing === undefined) {
    return Result.fail(specNotFound(primitive, name));
  }
  return existing.status === 'retired' ? nothingToRecord : recording({ type: 'spec_retired', name, by, at });
}

export function decideOnSpecs(primitive: string, command: SpecCommand, registry: SpecRegistry): Decision {
  if (command.type === 'create') {
    return decideCreation(primitive, command, registry);
  }
  if (command.type === 'update') {
    return decideUpdate(primitive, command, registry);
  }
  return decideRetirement(primitive, command, registry);
}
