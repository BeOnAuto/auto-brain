import { brainCreatedOf } from '@beonauto/brains';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import {
  definitionRecordsIn,
  type ApplyDefinitionRecord,
  type DefinitionRecord,
} from '../triggers/definition-records.ts';
import type { BrainRecords } from './brain-records.ts';
import type { FollowedBrains } from './followed-brains.ts';
import { scannedListeners } from './listener-scan.ts';

export interface Discovery {
  readonly atStart: () => Effect.Effect<void>;
  readonly registriesAppended: (registries: readonly string[]) => Effect.Effect<void>;
  readonly brainSeen: (brainKey: string) => Effect.Effect<void>;
}

export interface DiscoveryParts {
  readonly database: HostDatabase;
  readonly brains: FollowedBrains;
  readonly records: BrainRecords;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (brainKey: string, record: DefinitionRecord) => Effect.Effect<void>;
  readonly definitionType: string;
}

const OrgStreamRow = Schema.Struct({ stream_id: Schema.String, stream_position: WholeNumber });

const SeenRow = Schema.Struct({ stream_id: Schema.String, position: WholeNumber });

const PositionRow = Schema.Struct({ position: WholeNumber });

const orgRegistry = /^org\/([^/]+)\/brains$/u;

export function isOrgRegistry(stream: string): boolean {
  return orgRegistry.test(stream);
}

function orgsOf(database: HostDatabase) {
  return Effect.orDie(
    Effect.zip(
      rowsOf(
        OrgStreamRow,
        database.read(
          statement`SELECT stream_id, stream_position FROM emt_streams
            WHERE stream_id LIKE 'org/%/brains' AND is_archived = FALSE`,
        ),
      ),
      rowsOf(SeenRow, database.read(statement`SELECT stream_id, position FROM workflow_followed_orgs`)),
    ),
  );
}

function seenOf(database: HostDatabase, stream: string): Effect.Effect<number | undefined> {
  return Effect.orDie(
    rowsOf(
      PositionRow,
      database.read(statement`SELECT position FROM workflow_followed_orgs WHERE stream_id = ${stream}`),
    ),
  ).pipe(Effect.map((rows) => rows.at(0)?.position));
}

function brainKeyOf(stream: string, brain: string): string {
  return stream.replace(orgRegistry, (_, org: string) => `brain/${org}/${brain}/`);
}

function followedAtTailOn({
  database,
  brains,
  records,
  applyDefinitionRecord,
  unreadable,
  definitionType,
}: DiscoveryParts) {
  const applied = (brainKey: string, record: DefinitionRecord) =>
    Effect.flatMap(applyDefinitionRecord(brainKey, record), (outcome) =>
      outcome === 'unreadable' ? unreadable(brainKey, record) : Effect.void,
    );
  return (brainKey: string) =>
    Effect.gen(function* () {
      const [, org = '', brain = ''] = brainKey.split('/');
      yield* brains.follow(brainKey, yield* records.tail({ org, brain }));
      const recorded = yield* Effect.promise(() => database.store.read(`${brainKey}definitions/${definitionType}`, 0));
      yield* Effect.forEach(definitionRecordsIn(recorded), (record) => applied(brainKey, record), { discard: true });
    });
}

export function brainDiscoveryOn(parts: DiscoveryParts): Discovery {
  const { database, brains } = parts;
  const followedAtTail = followedAtTailOn(parts);
  const registryRead = (stream: string, after: number | undefined, atStart: boolean) =>
    Effect.gen(function* () {
      const { messages, version } = yield* Effect.promise(() => database.store.read(stream, after ?? 0));
      if (version === after) {
        return;
      }
      const created = messages.flatMap((message) => {
        const brain = brainCreatedOf(message);
        return brain === undefined ? [] : [brainKeyOf(stream, brain)];
      });
      yield* Effect.forEach(
        created,
        (brainKey) => (atStart && after === undefined ? followedAtTail(brainKey) : brains.follow(brainKey, null)),
        { discard: true },
      );
      yield* Effect.orDie(
        database.write(
          statement`INSERT INTO workflow_followed_orgs (stream_id, position) VALUES (${stream}, ${version})
            ON CONFLICT (stream_id) DO UPDATE SET position = excluded.position`,
        ),
      );
    });
  const everyRegistry = Effect.gen(function* () {
    const [streams, seen] = yield* orgsOf(database);
    const seenAt = new Map(seen.map(({ stream_id: stream, position }) => [stream, position]));
    yield* Effect.forEach(
      streams.filter(({ stream_id: stream, stream_position: position }) => seenAt.get(stream) !== position),
      ({ stream_id: stream }) => registryRead(stream, seenAt.get(stream), true),
      { discard: true },
    );
  });
  return {
    atStart: () => Effect.andThen(everyRegistry, scannedListeners(database)),
    registriesAppended: (registries) =>
      Effect.forEach(
        registries,
        (stream) => Effect.flatMap(seenOf(database, stream), (after) => registryRead(stream, after, false)),
        { discard: true },
      ),
    brainSeen: (brainKey) => brains.follow(brainKey, null),
  };
}
