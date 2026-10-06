import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { at, eventTrigger, published, specRecorded } from '../reaction-testing/brain-writes.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import type { Trigger } from '../reactions/reaction-options.ts';
import { runAt, startOf, workflow } from './host-documents.ts';
import type { SettingsOf } from './host-files.ts';

const aWhile = 30_000;

const attempts = 2000;

const waiting = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

const listening = workflow('do:\n  - await: { listen: { to: { one: { with: { type: com.acme.decided } } } } }');

export function reactionSuite(settings: SettingsOf): void {
  it('starts a workflow whose trigger an event matches', { timeout: aWhile }, async () => {
    const reacting = await reactingHost({ settings: await settings() });
    const trigger = eventTrigger({ type: 'com.acme.closed' });
    await specRecorded(reacting.database.store, { name: 'close', version: 1, trigger });

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.closed' });
    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
      attempts,
    );

    expect(starts.map(({ workflow: name, depth }) => [name, depth])).toEqual([['close', 1]]);
  });

  it('offers an event published to the brain to a run that listens for it', { timeout: aWhile }, async () => {
    const reacting = await reactingHost({ settings: await settings() });
    await Effect.runPromise(reacting.host.start(runAt(waiting), startOf(listening)));

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.decided', data: 'decided' });
    const state = await until(
      () => Effect.runPromise(reacting.host.stateOf(runAt(waiting))),
      (found) => found.status === 'ended',
      attempts,
    );

    expect(state.outcome).toEqual({ kind: 'completed', output: ['decided'] });
  });

  it('starts a workflow whose trigger is a schedule at its due time', { timeout: aWhile }, async () => {
    const activatedAt = Date.parse(at);
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ settings: await settings(), clock });
    const trigger: Trigger = { kind: 'every', milliseconds: 60_000 };
    await specRecorded(reacting.database.store, { name: 'tick', version: 1, trigger });

    clock.moveTo(activatedAt + 60_000);
    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
      attempts,
    );

    expect(starts.map(({ input }) => input)).toEqual([{ schedule: { due: '2026-10-01T09:01:00.000Z' } }]);
  });
}
