import { Conflict, plainNumber, type Rejection } from '@beonauto/operations';
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

export interface RegistryRules {
  readonly primitive: string;
  readonly mostActive: number;
}

function activeIn(registry: SpecRegistry): number {
  return [...registry.values()].filter(({ status }) => status === 'active').length;
}

function tooMany({ primitive, mostActive }: RegistryRules, active: number, saving: string): Conflict {
  const label = definitionResourceLabel(primitive);
  return new Conflict({
    detail: `The brain keeps ${plainNumber(active)} active ${label}s, and a brain may keep at most ${plainNumber(mostActive)}; retire one before ${saving}`,
  });
}

function decideCreation(
  rules: RegistryRules,
  { name, content, by, at }: SpecCreation & CommandMetadata,
  registry: SpecRegistry,
): Decision {
  const existing = registry.get(name);
  if (existing !== undefined) {
    return Result.fail(takenBy(rules.primitive, existing));
  }
  const active = activeIn(registry);
  if (active >= rules.mostActive) {
    return Result.fail(tooMany(rules, active, 'creating another'));
  }
  const beyond = beyondTheReactingBound(rules.primitive, registry, { name, content });
  return beyond === undefined
    ? recording({ type: 'spec_created', name, version: 1, content, by, at })
    : Result.fail(beyond);
}

function decideUpdate(
  rules: RegistryRules,
  { name, content, by, at }: SpecUpdate & CommandMetadata,
  registry: SpecRegistry,
): Decision {
  const { primitive } = rules;
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
  const active = activeIn(registry);
  if (active > rules.mostActive) {
    return Result.fail(tooMany(rules, active, 'saving another version'));
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

export function decideOnSpecs(rules: RegistryRules, command: SpecCommand, registry: SpecRegistry): Decision {
  if (command.type === 'create') {
    return decideCreation(rules, command, registry);
  }
  if (command.type === 'update') {
    return decideUpdate(rules, command, registry);
  }
  return decideRetirement(rules.primitive, command, registry);
}
