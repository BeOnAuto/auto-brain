import type { EventStore } from '@beonauto/ledger';
import { describe, expect, it } from 'vitest';

import {
  alpha,
  at,
  brainCreated,
  cronTrigger,
  eventTrigger,
  everyTrigger,
  recorded,
  definitionRecordAt,
  definitionRecorded,
} from '../reaction-testing/brain-writes.ts';
import { triggerRowsOf, untilTriggersAt } from '../reaction-testing/kept-triggers.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

async function definitionsOfTheBrain(store: EventStore): Promise<void> {
  const closed = eventTrigger({ type: 'com.acme.closed' });
  await brainCreated(store, 'alpha');
  await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed, everyTrigger(15 * aMinute)] });
  await definitionRecorded(store, {
    name: 'close',
    version: 2,
    triggers: [closed, everyTrigger(15 * aMinute), cronTrigger('0 18 * * *')],
    when: isoAt(1),
  });
  await definitionRecorded(store, {
    name: 'close',
    version: 3,
    triggers: [eventTrigger({ type: 'com.acme.opened' }), everyTrigger(15 * aMinute)],
    when: isoAt(2),
  });
  await definitionRecorded(store, { name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] });
  await definitionRecorded(store, { name: 'tick', version: 2, triggers: [everyTrigger(2 * aMinute)], when: isoAt(3) });
}

describe('the triggers of a brain made again from the records of its definitions', () => {
  it('are the rows the follower kept as it passed the same records one by one', async () => {
    const live = await reactingHost({ clock: movedClock(activatedAt + 1000) });
    await definitionsOfTheBrain(live.database.store);
    await untilTriggersAt(live.database, 'tick', 2);
    const settings = await onSQLite();
    await definitionsOfTheBrain((await openedOn(settings)).store);

    const rebuilt = await reactingHost({ settings, clock: movedClock(activatedAt + 1000) });
    await untilTriggersAt(rebuilt.database, 'tick', 2);
    const rows = await triggerRowsOf(rebuilt.database);

    expect(rows).toEqual(await triggerRowsOf(live.database));
    expect(
      rows.map(({ workflow, reference, version, activated_by: by }) => [workflow, reference, version, by]),
    ).toEqual([
      ['close', '/schedule/every', 3, definitionRecordAt(1)],
      ['close', '/schedule/on', 3, definitionRecordAt(3)],
      ['tick', '/schedule/every', 2, definitionRecordAt(5)],
    ]);
  });

  it('pass over a record that cannot be read, which is said', async () => {
    const settings = await onSQLite();
    const { store } = await openedOn(settings);
    await brainCreated(store, 'alpha');
    await recorded(store, `${alpha}definitions/workflow`, { type: 'definition_created', name: 7 });
    const { version } = await store.read(`${alpha}definitions/workflow`);
    await store.append(`${alpha}definitions/workflow`, [{ type: 'definition_created', data: { name: 8 } }], version);
    await definitionRecorded(store, { name: 'tick', version: 1, triggers: [everyTrigger(aMinute)] });

    const reacting = await reactingHost({ settings, clock: movedClock(activatedAt + 1000) });
    await untilTriggersAt(reacting.database, 'tick', 1);
    const notes = await until(
      () => Promise.resolve(reacting.notes()),
      (found) => found.length >= 2,
    );

    expect(notes).toEqual([
      {
        kind: 'record_unreadable',
        org: 'acme',
        brain: 'alpha',
        recordId: definitionRecordAt(1),
        type: 'definition_created',
      },
      { kind: 'record_unreadable', org: 'acme', brain: 'alpha', recordId: definitionRecordAt(2), type: 'unknown' },
    ]);
  });
});
