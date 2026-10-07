import { Conflict } from '@beonauto/operations';
import type { RunInput, Submission } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { alpha, at, recorded } from '../reaction-testing/brain-writes.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { passedOverRow, pendingCancelRowsAfter } from './pending-cancel-rows.ts';
import { pendingCancelsGivenOnce } from './pending-cancels.ts';

const cancel = { by: 'acme-admin', kind: 'requested', reason: 'Not needed any more' } as const;

const outcomes: Readonly<Record<string, Submission['outcome'] | 'conflict'>> = {
  'acme/alpha/applied': 'applied',
  'acme/alpha/ended': 'stale',
  'acme/alpha/failing': 'conflict',
  'acme/alpha/not-started': 'not_started',
  'acme/alpha/finished-unstarted': 'not_started',
  'acme/alpha/stranded': 'not_started',
};

const ofTheRun = { primitive: 'orchestration', name: 'pause', spec_version: 1, by: 'acme-admin', at };

interface Resumed {
  readonly database: ReturnType<typeof faultyDatabase>;
  readonly given: () => readonly string[];
  readonly troubles: () => readonly string[];
  readonly resume: () => Promise<void>;
  readonly pending: () => Promise<readonly string[]>;
  readonly failingNoMore: () => void;
}

async function pendingFor(runIds: readonly string[], database: HostDatabase): Promise<void> {
  await Effect.runPromise(
    Effect.forEach(runIds, (runId) => passedOverRow(database, { runId, cause: `${runId}-asked`, cancel })),
  );
}

async function resumedWith(runIds: readonly string[]): Promise<Resumed> {
  const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
  await pendingFor(runIds, database);
  const given: string[] = [];
  const troubles: string[] = [];
  const failing = { still: true };
  const submitted = (input: RunInput) =>
    Effect.suspend(() => {
      given.push(input.executionId);
      const outcome = outcomes[input.executionId] ?? 'applied';
      return outcome === 'conflict' && failing.still
        ? Effect.fail(new Conflict({ detail: 'The log of the run kept changing' }))
        : Effect.succeed({ outcome: outcome === 'conflict' ? 'applied' : outcome, version: 2 });
    });
  const cancelsAsked = pendingCancelsGivenOnce({ database, submitted, now: () => 1 }, (what) =>
    Effect.sync(() => {
      troubles.push(what);
    }),
  );
  return {
    database,
    given: () => given,
    troubles: () => troubles,
    resume: () => Effect.runPromise(cancelsAsked),
    pending: async () =>
      (await Effect.runPromise(pendingCancelRowsAfter(database, '', 1000))).map(({ runId }) => runId),
    failingNoMore: () => {
      failing.still = false;
    },
  };
}

describe('the cancels the follower passed over, given at the first resume after a host takes the workflows', () => {
  it('are each given to its run, cleared once the run took it or had ended, and kept for a run not started', async () => {
    const resumed = await resumedWith(['acme/alpha/applied', 'acme/alpha/ended', 'acme/alpha/not-started']);

    await resumed.resume();
    await resumed.resume();

    expect([...resumed.given()].toSorted()).toEqual([
      'acme/alpha/applied',
      'acme/alpha/ended',
      'acme/alpha/not-started',
    ]);
    expect(await resumed.pending()).toEqual(['acme/alpha/not-started']);
    expect(resumed.troubles()).toEqual([]);
  });

  it('are cleared for a run that finished without ever reaching the host, by the newest head of its stream', async () => {
    const resumed = await resumedWith(['acme/alpha/finished-unstarted', 'acme/alpha/stranded']);
    const asked = { type: 'execution_cancel_requested', kind: 'requested', reason: 'Not needed any more', ...ofTheRun };
    await recorded(resumed.database.store, `${alpha}executions/finished-unstarted`, asked);
    await recorded(resumed.database.store, `${alpha}executions/finished-unstarted`, {
      type: 'execution_rejected',
      rejection: { reason: 'unavailable', detail: 'The workflow could not be started' },
      ...ofTheRun,
    });
    await recorded(resumed.database.store, `${alpha}executions/stranded`, asked);

    await resumed.resume();

    expect(await resumed.pending()).toEqual(['acme/alpha/stranded']);
  });

  it('report a run that could not take its cancel without holding the others, and give it again next', async () => {
    const resumed = await resumedWith(['acme/alpha/applied', 'acme/alpha/failing']);

    await resumed.resume();
    const keptAfterTheFailure = await resumed.pending();
    resumed.failingNoMore();
    await resumed.resume();
    await resumed.resume();

    expect(keptAfterTheFailure).toEqual(['acme/alpha/failing']);
    expect(resumed.troubles()).toEqual([
      'The cancel asked of acme/alpha/failing could not be given; the next sweep gives it again',
    ]);
    expect(resumed.given()).toEqual(['acme/alpha/applied', 'acme/alpha/failing', 'acme/alpha/failing']);
    expect(await resumed.pending()).toEqual([]);
  });
});

describe('the read of the cancels the follower passed over', () => {
  it('goes page after page, a hundred at a time, and again at the next resume when it failed', async () => {
    const runIds = Array.from({ length: 205 }, (_, index) => `acme/alpha/run-${String(index).padStart(3, '0')}`);
    const resumed = await resumedWith(runIds);

    resumed.database.failing(true);
    await resumed.resume();
    const givenWhileFailing = resumed.given().length;
    resumed.database.failing(false);
    await resumed.resume();
    await resumed.resume();

    expect(givenWhileFailing).toBe(0);
    expect(resumed.troubles()).toEqual([
      'The cancels the follower passed over could not be read; the next sweep reads them again',
    ]);
    expect([...resumed.given()].toSorted()).toEqual(runIds);
    expect(await resumed.pending()).toEqual([]);
  });
});
