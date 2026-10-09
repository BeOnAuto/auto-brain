import { setTimeout } from 'node:timers/promises';

import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';
import { eventTrigger, published, definitionRecorded } from '../reaction-testing/brain-writes.ts';
import { heldStart, type HeldStart } from '../reaction-testing/held-start.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';

const anHourMs = 3_600_000;

const sweepEveryMs = 20;

async function startingAReaction(held: HeldStart, settings: DatabaseSettings): Promise<ReactingHost> {
  const reacting = await reactingHost({ settings, start: held.start, sweepEveryMs });
  const trigger = eventTrigger({ type: 'com.acme.closed' });
  await definitionRecorded(reacting.database.store, { name: 'close', version: 1, triggers: [trigger] });
  await published(reacting.database.store, { id: 'e1', type: 'com.acme.closed' });
  await held.begun;
  return reacting;
}

describe('a reaction starting a run while its host stops serving', () => {
  it('starts the run before the host refuses starts, when the host is told to stop', async () => {
    const held = heldStart();
    const reacting = await startingAReaction(held, { store: 'sqlite', file: aSQLiteFile() });

    const stopping = reacting.host.stop();
    held.release(reacting.host);
    await stopping;

    expect(held.exits()).toEqual([Exit.succeed('started')]);
  }, 30_000);

  it('starts the run before the host stands by, when another host takes the workflows over', async () => {
    const held = heldStart();
    const settings: DatabaseSettings = { store: 'sqlite', file: aSQLiteFile() };
    const reacting = await startingAReaction(held, settings);

    await hostedOn(settings, { holder: 'ahead', clock: { now: () => Date.now() + anHourMs, sleep: Effect.sleep } });
    await setTimeout(10 * sweepEveryMs);
    held.release(reacting.host);
    const notes = await until(
      () => Promise.resolve(reacting.notes()),
      (noted) => noted.length > 0,
    );

    expect(held.exits()).toEqual([Exit.succeed('started')]);
    expect(notes).toMatchObject([{ kind: 'standing_by', holder: 'ahead' }]);
  }, 30_000);
});
