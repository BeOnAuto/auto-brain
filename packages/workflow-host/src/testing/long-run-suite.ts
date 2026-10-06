import { evolveRun, loadedRunOf, newRun, snapshotEveryBytes } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { skippingClock } from '../loop/host-clock.ts';
import { ledgerRunStore } from '../runs/ledger-run-store.ts';
import { eventually } from './eventually.ts';
import { runAt, startOf, workflow } from './host-documents.ts';
import { openedOn, type SettingsOf } from './host-files.ts';
import { hostedOn } from './host-runs.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-000000003000';

const longRunInputs = 130;

const paddingCharacters = 8000;

const ticking = workflow(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ { n: ((.n // 0) + 1), padding: ("x" * ${paddingCharacters}) } }' }
  - again: { switch: [{ more: { when: '\${ .n < ${longRunInputs - 1} }', then: tick } }] }
`);

export function longRunSuite(settings: SettingsOf): void {
  it(`runs a loop of ${longRunInputs} inputs of ${paddingCharacters} characters each, and loads it again from its last snapshot and the events after it`, async () => {
    const database = await settings();
    const hosted = await hostedOn(database, { clock: skippingClock(1_790_845_200_000), sweepEveryMs: 3_600_000 });
    hosted.know(executionId);

    await Effect.runPromise(hosted.host.start(runAt(executionId), startOf(ticking)));
    await eventually(hosted.settlements, (settled) => settled.size > 0, 5000);
    await hosted.host.stop();
    const runStore = ledgerRunStore(await openedOn(database));
    const stored = await Effect.runPromise(runStore.load(`acme/alpha/${executionId}`));
    const events = await Effect.runPromise(runStore.eventsAfter(`acme/alpha/${executionId}`, 0));
    const resumed = loadedRunOf(stored);

    expect(events).toHaveLength(longRunInputs);
    expect(stored.snapshot?.snapshot.version).toBeGreaterThan(longRunInputs / 2);
    expect(resumed.sinceSnapshot.bytes).toBeLessThan(snapshotEveryBytes);
    expect(stored.tail.length).toBeGreaterThan(0);
    expect(resumed.state).toEqual(events.reduce((state, { event }) => evolveRun(state, event), newRun));
    expect(resumed.state.outcome).toEqual({
      kind: 'completed',
      output: { n: longRunInputs - 1, padding: 'x'.repeat(paddingCharacters) },
    });
  }, 60_000);
}
