import { messageIdOf } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { statement } from '../database/statement.ts';
import {
  alpha,
  brainCreated,
  brainRenamed,
  eventTrigger,
  published,
  specRecorded,
} from '../reaction-testing/brain-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

const beta = 'brain/acme/beta/';

const closed = eventTrigger({ type: 'com.acme.closed' });

const sentinel = eventTrigger({ type: 'com.acme.sentinel' });

function startsReaching(reacting: ReactingHost, count: number) {
  return until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.length >= count,
  );
}

describe('a brain its org created before the host started', () => {
  it('is followed from its latest record, with the triggers its workflows already had', async () => {
    const settings = await onSQLite();
    const { store } = await openedOn(settings);
    await brainCreated(store, 'alpha');
    await specRecorded(store, { name: 'close', version: 1, trigger: closed });
    await published(store, { id: 'before', type: 'com.acme.closed' });

    const reacting = await reactingHost({ settings });
    await published(store, { id: 'after', type: 'com.acme.closed' });
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ cause }) => cause)).toEqual([messageIdOf(`${alpha}events/after`, 1)]);
  });
});

describe('a brain its org creates while the host runs', () => {
  it('is followed from its first record', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await brainCreated(store, 'alpha');
    await brainRenamed(store, 'alpha');

    await brainCreated(store, 'beta');
    await specRecorded(store, { name: 'watch', version: 1, trigger: sentinel }, beta);
    await published(store, { id: 's1', type: 'com.acme.sentinel' }, {}, beta);
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ brain, workflow }) => [brain, workflow])).toEqual([['beta', 'watch']]);
  });
});

describe('a brain its org created while the host was stopped', () => {
  it('is followed from its first record when the host starts again', async () => {
    const settings = await onSQLite();
    const first = await reactingHost({ settings });
    await brainCreated(first.database.store, 'alpha');
    await until(
      () => Effect.runPromise(first.database.read(statement`SELECT position FROM workflow_followed_orgs`)),
      (rows) => rows.length > 0,
    );
    await first.host.stop();

    await brainCreated(first.database.store, 'beta');
    await specRecorded(first.database.store, { name: 'watch', version: 1, trigger: sentinel }, beta);
    await published(first.database.store, { id: 's1', type: 'com.acme.sentinel' }, {}, beta);
    const second = await reactingHost({ settings });
    const starts = await startsReaching(second, 1);

    expect(starts.map(({ brain, workflow }) => [brain, workflow])).toEqual([['beta', 'watch']]);
  });
});
