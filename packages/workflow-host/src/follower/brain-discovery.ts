import { brainCreatedOf } from '@beonauto/brains';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import type { ApplySpecRecord } from '../reactions/spec-records.ts';
import type { BrainRecords } from './brain-records.ts';
import type { FollowedBrains } from './followed-brains.ts';
import { scannedListeners } from './listener-scan.ts';

export interface Discovery {
  readonly atStart: () => Effect.Effect<void>;
  readonly orgsChanged: () => Effect.Effect<void>;
  readonly brainSeen: (brainKey: string) => Effect.Effect<void>;
}

export interface DiscoveryParts {
  readonly database: HostDatabase;
  readonly brains: FollowedBrains;
  readonly records: BrainRecords;
  readonly applySpecRecord: ApplySpecRecord;
  readonly primitive: string;
}

const OrgStreamRow = Schema.Struct({ stream_id: Schema.String, stream_position: WholeNumber });

const SeenRow = Schema.Struct({ stream_id: Schema.String, position: WholeNumber });

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

function brainKeyOf(stream: string, brain: string): string {
  return stream.replace(orgRegistry, (_, org: string) => `brain/${org}/${brain}/`);
}

export function brainDiscoveryOn(parts: DiscoveryParts): Discovery {
  const { database, brains, records, applySpecRecord, primitive } = parts;
  const rebuilt = (brainKey: string) =>
    Effect.gen(function* () {
      const { events } = yield* Effect.promise(() => database.store.read(`${brainKey}specs/${primitive}`, 0));
      yield* Effect.forEach(events, (data) => applySpecRecord(brainKey, data), { discard: true });
    });
  const followedAtTail = (brainKey: string) =>
    Effect.gen(function* () {
      const [, org = '', brain = ''] = brainKey.split('/');
      yield* brains.follow(brainKey, yield* records.tail({ org, brain }));
      yield* rebuilt(brainKey);
    });
  const newBrains = (atStart: boolean) =>
    Effect.gen(function* () {
      const [streams, seen] = yield* orgsOf(database);
      const seenAt = new Map(seen.map(({ stream_id: stream, position }) => [stream, position]));
      for (const { stream_id: stream, stream_position: position } of streams) {
        const after = seenAt.get(stream);
        if (after !== position) {
          const { events } = yield* Effect.promise(() => database.store.read(stream, after ?? 0));
          const created = events.flatMap((data) => {
            const brain = brainCreatedOf(data);
            return brain === undefined ? [] : [brainKeyOf(stream, brain)];
          });
          yield* Effect.forEach(
            created,
            (brainKey) => (atStart && after === undefined ? followedAtTail(brainKey) : brains.follow(brainKey, null)),
            { discard: true },
          );
          yield* Effect.orDie(
            database.write(
              statement`INSERT INTO workflow_followed_orgs (stream_id, position) VALUES (${stream}, ${position})
                ON CONFLICT (stream_id) DO UPDATE SET position = excluded.position`,
            ),
          );
        }
      }
    });
  return {
    atStart: () => Effect.andThen(newBrains(true), scannedListeners(database)),
    orgsChanged: () => newBrains(false),
    brainSeen: (brainKey) => brains.follow(brainKey, null),
  };
}
