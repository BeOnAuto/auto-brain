import { streamPrefixOfBrain, type BrainAddress } from '@beonauto/operations';
import { Effect } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { keptViewOf, viewRowOf, ViewRowSchema, type KeptView } from './view-rows.ts';
import { viewNamed } from './view-statements.ts';

export interface ViewsPort {
  readonly viewOf: (brain: BrainAddress, name: string) => Effect.Effect<KeptView | undefined>;
  readonly newestRecordAt: (brain: BrainAddress) => Effect.Effect<string | undefined>;
}

export function viewsPortOn(database: HostDatabase): ViewsPort {
  return {
    viewOf: (brain, name) =>
      Effect.orDie(rowsOf(ViewRowSchema, database.read(viewNamed(streamPrefixOfBrain(brain), name)))).pipe(
        Effect.map(([row]) => (row === undefined ? undefined : keptViewOf(viewRowOf(row)))),
      ),
    newestRecordAt: (brain) =>
      Effect.promise(() =>
        database.store.readRecorded(streamPrefixOfBrain(brain), { kind: 'everything' }, { order: 'desc', limit: 1 }),
      ).pipe(Effect.map(({ records: [newest] }) => newest?.recordedAt)),
  };
}
