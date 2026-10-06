import { Conflict, type Rejection } from '@beonauto/operations';
import { Result } from 'effect';

import { definitionResourceLabel } from '../primitive/function-terminology.ts';
import { specNotFound } from './registry-lookup.ts';
import type { CommandMetadata, SpecCommand, SpecCreation, SpecRetirement, SpecUpdate } from './spec-commands.ts';
import type { SpecEvent } from './spec-events.ts';
import type { SpecRegistry } from './spec-registry.ts';
import type { StoredDefinition } from './spec.ts';

type Decision = Result.Result<readonly SpecEvent[], Rejection<'not_found' | 'conflict'>>;

const nothingToRecord: Decision = Result.succeed([]);

export const mostReactingDefinitions = 1024;

function reactingOtherThan(registry: SpecRegistry, name: string): number {
  return [...registry.values()].filter((spec) => spec.status === 'active' && spec.reacts === true && spec.name !== name)
    .length;
}

function beyondTheReactingBound(
  primitive: string,
  registry: SpecRegistry,
  { name, content }: Pick<SpecCreation, 'name' | 'content'>,
): Conflict | undefined {
  return content.reacts === true && reactingOtherThan(registry, name) >= mostReactingDefinitions
    ? new Conflict({
        detail: `The brain already has ${mostReactingDefinitions} ${definitionResourceLabel(primitive)}s that start on their own, the most a brain holds; retire one, or save this one without its schedule`,
      })
    : undefined;
}

function recording(event: SpecEvent): Decision {
  return Result.succeed([event]);
}

function takenBy(primitive: string, { name, status }: StoredDefinition): Conflict {
  return new Conflict({
    detail:
      status === 'active'
        ? `The brain already has the ${definitionResourceLabel(primitive)} ${name}`
        : `The ${definitionResourceLabel(primitive)} ${name} was retired, and a definition name is never reused`,
    kind: 'taken',
  });
}

function decideCreation(
  primitive: string,
  { name, content, by, at }: SpecCreation & CommandMetadata,
  registry: SpecRegistry,
): Decision {
  const existing = registry.get(name);
  if (existing !== undefined) {
    return Result.fail(takenBy(primitive, existing));
  }
  const beyond = beyondTheReactingBound(primitive, registry, { name, content });
  return beyond === undefined
    ? recording({ type: 'spec_created', name, version: 1, content, by, at })
    : Result.fail(beyond);
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
      new Conflict({
        detail: `The ${definitionResourceLabel(primitive)} ${name} is retired and can no longer change`,
        kind: 'retired',
      }),
    );
  }
  if (existing.source === content.source) {
    return nothingToRecord;
  }
  const beyond = beyondTheReactingBound(primitive, registry, { name, content });
  return beyond === undefined
    ? recording({ type: 'spec_updated', name, version: existing.version + 1, content, by, at })
    : Result.fail(beyond);
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
