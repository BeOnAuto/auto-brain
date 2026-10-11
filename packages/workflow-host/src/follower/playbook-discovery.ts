import { playbookCreatedOf } from '@beonauto/playbooks';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import {
  definitionRecordsIn,
  type ApplyDefinitionRecord,
  type DefinitionRecord,
} from '../triggers/definition-records.ts';
import type { FollowedPlaybooks } from './followed-playbooks.ts';
import { scannedListeners } from './listener-scan.ts';
import type { PlaybookRecords } from './playbook-records.ts';

export interface Discovery {
  readonly atStart: () => Effect.Effect<void>;
  readonly registriesAppended: (registries: readonly string[]) => Effect.Effect<void>;
  readonly playbookSeen: (playbookKey: string) => Effect.Effect<void>;
}

export interface DiscoveryParts {
  readonly database: HostDatabase;
  readonly playbooks: FollowedPlaybooks;
  readonly records: PlaybookRecords;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (playbookKey: string, record: DefinitionRecord) => Effect.Effect<void>;
  readonly definitionType: string;
}

const OrgStreamRow = Schema.Struct({ stream_id: Schema.String, stream_position: WholeNumber });

const SeenRow = Schema.Struct({ stream_id: Schema.String, position: WholeNumber });

const PositionRow = Schema.Struct({ position: WholeNumber });

const orgRegistry = /^org\/([^/]+)\/playbooks$/u;

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
            WHERE stream_id LIKE 'org/%/playbooks' AND is_archived = FALSE`,
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

function playbookKeyOf(stream: string, playbook: string): string {
  return stream.replace(orgRegistry, (_, org: string) => `playbook/${org}/${playbook}/`);
}

function followedAtTailOn({
  database,
  playbooks,
  records,
  applyDefinitionRecord,
  unreadable,
  definitionType,
}: DiscoveryParts) {
  const applied = (playbookKey: string, record: DefinitionRecord) =>
    Effect.flatMap(applyDefinitionRecord(playbookKey, record), (outcome) =>
      outcome === 'unreadable' ? unreadable(playbookKey, record) : Effect.void,
    );
  return (playbookKey: string) =>
    Effect.gen(function* () {
      const [, org = '', playbook = ''] = playbookKey.split('/');
      yield* playbooks.follow(playbookKey, yield* records.tail({ org, playbook }));
      const recorded = yield* Effect.promise(() =>
        database.store.read(`${playbookKey}definitions/${definitionType}`, 0),
      );
      yield* Effect.forEach(definitionRecordsIn(recorded), (record) => applied(playbookKey, record), { discard: true });
    });
}

export function playbookDiscoveryOn(parts: DiscoveryParts): Discovery {
  const { database, playbooks } = parts;
  const followedAtTail = followedAtTailOn(parts);
  const registryRead = (stream: string, after: number | undefined, atStart: boolean) =>
    Effect.gen(function* () {
      const { events, version } = yield* Effect.promise(() => database.store.read(stream, after ?? 0));
      if (version === after) {
        return;
      }
      const created = events.flatMap((data) => {
        const playbook = playbookCreatedOf(data);
        return playbook === undefined ? [] : [playbookKeyOf(stream, playbook)];
      });
      yield* Effect.forEach(
        created,
        (playbookKey) =>
          atStart && after === undefined ? followedAtTail(playbookKey) : playbooks.follow(playbookKey, null),
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
    playbookSeen: (playbookKey) => playbooks.follow(playbookKey, null),
  };
}
