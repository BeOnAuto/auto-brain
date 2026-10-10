import { streamSignalOf } from '@beonauto/ledger';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { filterStops } from '../filtering/filter-matching.ts';
import { systemClock } from '../loop/host-clock.ts';
import { startReacting } from '../reactions/host-reactions.ts';
import { refusalsOn } from '../reactions/refusals.ts';
import { recordingReports } from '../testing/recording-reports.ts';
import { recordedReactions, type RecordedReactions } from './recorded-reactions.ts';

export function followerOver(database: HostDatabase, sweepEveryMs: number): RecordedReactions {
  const reactions = recordedReactions();
  const follower = startReacting(
    {
      database,
      submitted: Effect.die,
      clock: systemClock,
      sweepEveryMs,
      reports: recordingReports().reports,
    },
    { ...reactions.options, appended: streamSignalOf() },
    { refusals: refusalsOn(database, Date.now), stops: filterStops() },
    { consumers: [], calls: [] },
  );
  onTestFinished(() => follower.stop());
  return reactions;
}
