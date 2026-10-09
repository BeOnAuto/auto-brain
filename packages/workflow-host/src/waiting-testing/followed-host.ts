import { recordedReaderOf } from '@beonauto/ledger';
import type { Settlement } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { alpha, brainCreated } from '../reaction-testing/brain-writes.ts';
import { until } from '../reaction-testing/until.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn, type HostedOptions, type HostedRuns } from '../testing/host-runs.ts';

export interface FollowedHost {
  readonly database: HostDatabase;
  readonly hosted: HostedRuns;
  readonly settled: (runId: string) => Promise<Settlement | undefined>;
}

export function settledIn(hosted: HostedRuns, attempts?: number): (runId: string) => Promise<Settlement | undefined> {
  return (runId) =>
    until(
      () => Promise.resolve(hosted.settlements().get(runId)),
      (settlement) => settlement !== undefined,
      attempts,
    );
}

export async function untilFollowed(database: HostDatabase, attempts?: number): Promise<void> {
  await until(
    () => Effect.runPromise(database.read(statement`SELECT brain_key FROM workflow_followed_brains`)),
    (rows) => rows.length > 0,
    attempts,
  );
}

export async function followedHost(options: HostedOptions = {}): Promise<FollowedHost> {
  const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
  const database = await openedOn(settings);
  await brainCreated(database.store, 'alpha');
  const hosted = await hostedOn(settings, options);
  await untilFollowed(database);
  return {
    database,
    hosted,
    settled: settledIn(hosted),
  };
}

const Places = Schema.Array(Schema.Struct({ cursor: Schema.NullOr(Schema.String) }));

export async function followedThroughTheLatest(database: HostDatabase, attempts?: number): Promise<void> {
  const { records } = await Effect.runPromise(
    recordedReaderOf(database.store)(
      { org: 'acme', brain: 'alpha' },
      { kind: 'everything' },
      { order: 'desc', limit: 1 },
    ),
  );
  await until(
    async () =>
      Schema.decodeUnknownSync(Places)(
        await Effect.runPromise(
          database.read(statement`SELECT cursor FROM workflow_followed_brains WHERE brain_key = ${alpha}`),
        ),
      ),
    (places) => places[0]?.cursor === records[0]?.cursor,
    attempts,
  );
}
