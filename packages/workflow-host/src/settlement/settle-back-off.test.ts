import { Conflict, type Settlement } from '@beonauto/operations';
import type { SettleExecution } from '@beonauto/specs';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostNote } from '../host/host-reports.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { runId } from '../testing/probe-subjects.ts';
import { ledgerRecordStore } from './ledger-record-store.ts';
import { settleAttemptsBeforeBackingOff, settleBackOffMs } from './settle-attempts.ts';

const run = { executionId: runId, attributes: {} };

const succeeded: Settlement = { status: 'succeeded', output: 'done' };

const stillRunning = new Conflict({
  detail: 'The execution runs within the call that started it, so it cannot be settled',
});

const execution = {
  execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  primitive: 'orchestration',
  name: 'flow',
  spec_version: 1,
  status: 'succeeded',
  started_at: '2026-10-05T09:00:00.000Z',
  started_by: 'acme-admin',
} as const;

interface Recording {
  readonly recordStore: ReturnType<typeof ledgerRecordStore>;
  readonly at: (now: number) => void;
  readonly refusing: (refuses: boolean) => void;
  readonly attempts: () => number;
  readonly notes: () => readonly HostNote[];
}

async function recording(): Promise<Recording> {
  const state = { now: 0, refuses: true, attempts: 0 };
  const notes: HostNote[] = [];
  const settle: SettleExecution = () =>
    Effect.suspend(() => {
      state.attempts += 1;
      return state.refuses ? Effect.fail(stillRunning) : Effect.succeed(execution);
    });
  const recordStore = ledgerRecordStore(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), {
    settle,
    note: (note) =>
      Effect.sync(() => {
        notes.push(note);
      }),
    now: () => state.now,
  });
  return {
    recordStore,
    at: (now) => {
      state.now = now;
    },
    refusing: (refuses) => {
      state.refuses = refuses;
    },
    attempts: () => state.attempts,
    notes: () => notes,
  };
}

function settledOnce(recorded: Recording): Promise<Result.Result<string, { readonly detail: string }>> {
  return Effect.runPromise(
    Effect.result(recorded.recordStore.settle({ executionId: runId, settlement: succeeded }, run)),
  );
}

function refusedEveryAttemptBeforeBackingOff(recorded: Recording): Promise<readonly { readonly detail: string }[]> {
  const refused = Effect.flip(recorded.recordStore.settle({ executionId: runId, settlement: succeeded }, run));
  return Effect.runPromise(Effect.forEach(Array.from({ length: settleAttemptsBeforeBackingOff }), () => refused));
}

const address = addressOfRun(runId);

describe('the record store of the host, refused', () => {
  it(`tries again every dispatch, then after ${settleAttemptsBeforeBackingOff} attempts once a minute, saying so once`, async () => {
    const recorded = await recording();

    const refusals = await refusedEveryAttemptBeforeBackingOff(recorded);
    recorded.at(settleBackOffMs - 1);
    const backingOff = await settledOnce(recorded);
    recorded.at(settleBackOffMs);
    const againAMinuteLater = await settledOnce(recorded);

    expect(refusals).toHaveLength(settleAttemptsBeforeBackingOff);
    expect(backingOff).toMatchObject({
      failure: {
        detail: `The settlement failed ${settleAttemptsBeforeBackingOff} times, so it is tried again once every ${settleBackOffMs} ms`,
      },
    });
    expect(againAMinuteLater).toMatchObject({ failure: { detail: stillRunning.detail } });
    expect(recorded.attempts()).toBe(settleAttemptsBeforeBackingOff + 1);
    expect(recorded.notes()).toEqual([
      {
        kind: 'settle_backing_off',
        run: address,
        attempts: settleAttemptsBeforeBackingOff,
        detail: stillRunning.detail,
      },
    ]);
  });

  it('records the settlement once the record takes it, saying that it settled after backing off', async () => {
    const recorded = await recording();
    await refusedEveryAttemptBeforeBackingOff(recorded);
    recorded.refusing(false);
    recorded.at(settleBackOffMs);

    const settled = await settledOnce(recorded);
    const again = await settledOnce(recorded);

    expect([settled, again]).toEqual([Result.succeed('recorded'), Result.succeed('already_recorded')]);
    expect(recorded.notes().at(-1)).toEqual({
      kind: 'settled_after_back_off',
      run: address,
      attempts: settleAttemptsBeforeBackingOff + 1,
    });
  });
});
