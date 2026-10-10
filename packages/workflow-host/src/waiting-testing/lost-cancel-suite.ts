import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, at, brainCreated, recorded } from '../reaction-testing/brain-writes.ts';
import { until } from '../reaction-testing/until.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { pendingCancelRowsAfter } from '../waiting/pending-cancel-rows.ts';
import { startedByAHostThatDied } from './crashed-host.ts';
import { followedThroughTheLatest, settledIn, untilFollowed } from './followed-host.ts';
import {
  askedCancel,
  lostCancelId,
  lostRunId,
  lostRunKey,
  lostStart,
  lostStream,
  startedThenCancelled,
} from './lost-run.ts';

const aWhile = 30_000;

const attempts = 2000;

const ofTheRun = {
  by: 'brain:alpha',
  at,
  definitionType: 'workflow',
  definitionName: 'pause',
  definitionVersion: 1,
};

const rejectedUnstarted = {
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'The workflow could not be started' } },
};

const strandedId = '0199a3c4-7d2e-7c1a-9b3f-0000000000e1';

const strandedCancel = { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Gone' } };

function diedAfterTheStart(settingsOf: SettingsOf): void {
  describe('a host that died after it started a run and before it read the cancel its follower had passed over', () => {
    it(
      'leaves the cancel to the first resume of the next host, which ends the run cancelled',
      { timeout: aWhile },
      async () => {
        const settings = await settingsOf();
        const database = await openedOn(settings);
        await brainCreated(database.store, 'alpha');
        const first = await hostedOn(settings);
        await untilFollowed(database, attempts);
        await startedThenCancelled(database);
        await followedThroughTheLatest(database, attempts);
        await first.host.stop();
        await startedByAHostThatDied(database, lostRunKey, lostStart);

        const next = await hostedOn(settings);
        next.know(lostRunId);
        const settlement = await settledIn(next, attempts)(lostRunId);

        expect(settlement).toEqual({
          status: 'rejected',
          reason: 'cancelled',
          kind: askedCancel.kind,
          detail: askedCancel.reason,
          by: askedCancel.by,
        });
      },
    );
  });
}

function endedWithoutStarting(settingsOf: SettingsOf): void {
  describe('a cancel the follower passes over for a run the host has not started', () => {
    it(
      'is kept by the run with its request, until a first resume finds the run ended without ever starting',
      { timeout: aWhile },
      async () => {
        const settings = await settingsOf();
        const database = await openedOn(settings);
        await brainCreated(database.store, 'alpha');
        const first = await hostedOn(settings);
        await untilFollowed(database, attempts);
        const pending = () => Effect.runPromise(pendingCancelRowsAfter(database, '', 10));
        await startedThenCancelled(database);
        await recorded(database.store, `${alpha}runs/${strandedId}`, strandedCancel, ofTheRun);
        const kept = await until(pending, (rows) => rows.length === 2, attempts);
        await recorded(database.store, lostStream, rejectedUnstarted, ofTheRun);
        await followedThroughTheLatest(database, attempts);
        const keptAfterTheEnding = await pending();
        await first.host.stop();

        await hostedOn(settings);
        const left = await until(pending, (rows) => rows.length === 1, attempts);

        expect(kept.find(({ runKey }) => runKey === lostRunKey)).toEqual({
          runKey: lostRunKey,
          cause: lostCancelId,
          cancel: askedCancel,
        });
        expect(keptAfterTheEnding).toHaveLength(2);
        expect(left.map(({ runKey }) => runKey)).toEqual([`acme/alpha/${strandedId}`]);
      },
    );
  });
}

export function lostCancelSuite(settingsOf: SettingsOf): void {
  diedAfterTheStart(settingsOf);
  endedWithoutStarting(settingsOf);
}
