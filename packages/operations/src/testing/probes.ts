import { Effect, Option, Schema } from 'effect';

import {
  BrainDirectory,
  BrainReader,
  BrainScope,
  BrainWriter,
  Caller,
  IncidentReporter,
  Ledger,
  OrgReader,
  OrgScope,
  OrgWriter,
  defineCommand,
  defineQuery,
} from '../index.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

interface Sighting {
  readonly name: string;
  readonly found: boolean;
}

const visibleServices = Effect.gen(function* () {
  const services: readonly Sighting[] = [
    { name: 'Ledger', found: Option.isSome(yield* Effect.serviceOption(Ledger)) },
    { name: 'BrainDirectory', found: Option.isSome(yield* Effect.serviceOption(BrainDirectory)) },
    { name: 'IncidentReporter', found: Option.isSome(yield* Effect.serviceOption(IncidentReporter)) },
    { name: 'Caller', found: Option.isSome(yield* Effect.serviceOption(Caller)) },
    { name: 'OrgScope', found: Option.isSome(yield* Effect.serviceOption(OrgScope)) },
    { name: 'OrgReader', found: Option.isSome(yield* Effect.serviceOption(OrgReader)) },
    { name: 'OrgWriter', found: Option.isSome(yield* Effect.serviceOption(OrgWriter)) },
    { name: 'BrainScope', found: Option.isSome(yield* Effect.serviceOption(BrainScope)) },
    { name: 'BrainReader', found: Option.isSome(yield* Effect.serviceOption(BrainReader)) },
    { name: 'BrainWriter', found: Option.isSome(yield* Effect.serviceOption(BrainWriter)) },
  ];
  return services.filter(({ found }) => found).map(({ name }) => name);
});

const OrgView = Schema.Struct({ caller: Schema.String, org: Schema.String, visible: Schema.Array(Schema.String) });

const BrainView = Schema.Struct({ ...OrgView.fields, brain: Schema.String });

const viewFromOrg = Effect.fnUntraced(function* () {
  const { id } = yield* Caller;
  const { org } = yield* OrgScope;
  return { caller: id, org, visible: yield* visibleServices };
});

const viewFromBrain = Effect.fnUntraced(function* () {
  const { id } = yield* Caller;
  const { org, brain } = yield* BrainScope;
  return { caller: id, org, brain, visible: yield* visibleServices };
});

const peek = { title: 'Peek', description: 'Shows what the handler of a call can see.', reasons: [] };

export const peekOrgQuery = defineQuery('org', {
  ...peek,
  name: 'peek_org_query',
  route: { method: 'GET', path: '/peek' },
  inputSchema: Empty,
  outputSchema: OrgView,
  handle: viewFromOrg,
});

export const peekOrgCommand = defineCommand('org', {
  ...peek,
  name: 'peek_org_command',
  route: { method: 'POST', path: '/peek' },
  inputSchema: Empty,
  outputSchema: OrgView,
  handle: viewFromOrg,
});

export const peekBrainQuery = defineQuery('brain', {
  ...peek,
  name: 'peek_brain_query',
  route: { method: 'GET', path: '/peek' },
  inputSchema: Empty,
  outputSchema: BrainView,
  handle: viewFromBrain,
});

export const peekBrainCommand = defineCommand('brain', {
  ...peek,
  name: 'peek_brain_command',
  route: { method: 'POST', path: '/peek' },
  inputSchema: Empty,
  outputSchema: BrainView,
  handle: viewFromBrain,
});
