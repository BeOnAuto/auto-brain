import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { HostElsewhere } from '../host/run-requests.ts';
import { eventually } from './eventually.ts';
import { runAt, startOf, workflow } from './host-documents.ts';
import { aSQLiteFile, type SettingsOf } from './host-files.ts';
import { hostIn } from './host-processes.ts';
import { hostedOn } from './host-runs.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const sweepEveryMs = 400;

const listening = workflow('do:\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }');

export function leaseSuite(settings: SettingsOf): void {
  it('lets one host serve the workflows of a database, and a second take them over only once the first is gone', async () => {
    const database = await settings();
    const first = hostIn(database, 'hang-on-call', join(aSQLiteFile(), '..', 'settlements.jsonl'), sweepEveryMs);
    await first.said('calling');
    const second = await hostedOn(database, { sweepEveryMs });
    second.know(executionId);

    const refused = await Effect.runPromise(Effect.flip(second.host.start(runAt(executionId), startOf(listening))));
    await setTimeout(3 * sweepEveryMs);
    const performedWhileBothRan = second.calls().length;
    await first.killed();
    const settled = await eventually(second.settlements, (settlements) => settlements.size > 0, 2000);

    expect(refused).toBeInstanceOf(HostElsewhere);
    expect(performedWhileBothRan).toBe(0);
    expect(second.notes().map(({ kind }) => kind)).toEqual(['standing_by', 'took_over']);
    expect(second.calls()).toHaveLength(1);
    expect([...settled.keys()]).toEqual([executionId]);
  }, 60_000);

  it('hands the workflows over at the next sweep when the host serving them stops', async () => {
    const database = await settings();
    const first = await hostedOn(database, { sweepEveryMs, holder: 'first' });
    const second = await hostedOn(database, { sweepEveryMs, holder: 'second' });

    await first.host.stop();
    const notes = await eventually(second.notes, (noted) => noted.length > 1, 2000);

    expect(notes).toMatchObject([
      { kind: 'standing_by', holder: 'first' },
      { kind: 'took_over', holder: 'second' },
    ]);
  }, 60_000);
}
