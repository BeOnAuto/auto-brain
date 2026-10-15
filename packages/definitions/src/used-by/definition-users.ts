import { Option, Order, Schema } from 'effect';

import { functionTypeOrder } from '../capability/function-terminology.ts';
import { isPlaybookRunEventType } from '../events/playbook-facts.ts';
import { definitionSourcePrefix } from '../events/reserved-attributes.ts';
import { isDefinitionEventType } from '../registry/definition-events.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { CalledDefinitionSchema, type CalledDefinition } from './called-definitions.ts';
import type { DefinitionUser, NamedDefinition, UserRelation } from './user-relations.ts';

export type PlaybookRegistries = ReadonlyMap<string, DefinitionRegistry>;

const NamingFilterSchema = Schema.Struct({
  type: Schema.String,
  subject: Schema.optionalKey(Schema.Json),
  source: Schema.optionalKey(Schema.Json),
});

type NamingFilter = typeof NamingFilterSchema.Type;

const decodeNamingDetails = Schema.decodeUnknownOption(
  Schema.Struct({
    calls: Schema.optionalKey(Schema.Array(CalledDefinitionSchema)),
    filters: Schema.optionalKey(Schema.Array(NamingFilterSchema)),
  }),
);

const relationsOfRoles: Readonly<Record<NonNullable<CalledDefinition['role']>, UserRelation>> = {
  trainer: 'sends-builds',
  approver: 'asks-approval',
};

const typeRanks: readonly string[] = [...functionTypeOrder, 'workflow'];

function rankOf({ type }: DefinitionUser): number {
  const rank = typeRanks.indexOf(type);
  return rank === -1 ? typeRanks.length : rank;
}

const byTypeThenName = Order.combineAll([
  Order.mapInput(Order.Number, rankOf),
  Order.mapInput(Order.String, ({ type }: DefinitionUser) => type),
  Order.mapInput(Order.String, ({ name }: DefinitionUser) => name),
]);

function relationOfCall({ role }: CalledDefinition): UserRelation {
  return role === undefined ? 'calls' : relationsOfRoles[role];
}

function relationsOfFilter({ type, subject, source }: NamingFilter, used: NamedDefinition): readonly UserRelation[] {
  const named = `${used.type}/${used.name}`;
  if (isPlaybookRunEventType(type)) {
    return subject === named ? ['remembers-runs'] : [];
  }
  return isDefinitionEventType(type) && source === `${definitionSourcePrefix}${named}` ? ['remembers-changes'] : [];
}

function relationsOf(details: StoredDefinition['details'], used: NamedDefinition): readonly UserRelation[] {
  return Option.match(decodeNamingDetails(details), {
    onNone: () => [],
    onSome: ({ calls = [], filters = [] }) => [
      ...new Set([
        ...calls
          .filter(({ type, name }) => type === used.type && name === used.name)
          .map((call) => relationOfCall(call)),
        ...filters.flatMap((filter) => relationsOfFilter(filter, used)),
      ]),
    ],
  });
}

function usersIn(type: string, registry: DefinitionRegistry, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registry.values()]
    .filter(({ name, status }) => status === 'active' && !(type === used.type && name === used.name))
    .flatMap(({ name, details }) => relationsOf(details, used).map((relation) => ({ type, name, relation })));
}

export function usersOf(registries: PlaybookRegistries, used: NamedDefinition): readonly DefinitionUser[] {
  return [...registries]
    .flatMap(([type, registry]: readonly [string, DefinitionRegistry]) => usersIn(type, registry, used))
    .toSorted(byTypeThenName);
}
