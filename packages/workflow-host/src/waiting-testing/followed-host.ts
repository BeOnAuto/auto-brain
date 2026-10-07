import type { Settlement } from '@beonauto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { brainCreated } from '../reaction-testing/brain-writes.ts';
import { until } from '../reaction-testing/until.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn, type HostedOptions, type HostedRuns } from '../testing/host-runs.ts';

export interface FollowedHost {
  readonly database: HostDatabase;
  readonly hosted: HostedRuns;
  readonly settled: (executionId: string) => Promise<Settlement | undefined>;
}

export async function followedHost(options: HostedOptions = {}): Promise<FollowedHost> {
  const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
  const database = await openedOn(settings);
  await brainCreated(database.store, 'alpha');
  const hosted = await hostedOn(settings, options);
  await until(
    () => Effect.runPromise(database.read(statement`SELECT brain_key FROM workflow_followed_brains`)),
    (rows) => rows.length > 0,
  );
  return {
    database,
    hosted,
    settled: (executionId) =>
      until(
        () => Promise.resolve(hosted.settlements().get(executionId)),
        (settlement) => settlement !== undefined,
      ),
  };
}
