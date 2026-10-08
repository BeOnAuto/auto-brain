import { streamSignalOf } from '@beonauto/ledger';
import { describe, expect, it } from 'vitest';

import { brainCreated, eventTrigger, published, specRecorded } from '../reaction-testing/brain-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

const beta = 'brain/acme/beta/';

const closed = eventTrigger({ type: 'com.acme.closed' });

function startsReaching(reacting: ReactingHost, count: number) {
  return until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.length >= count,
    2000,
  );
}

describe('the brains another process writes to, which raises no signal here', () => {
  it(
    'passes a brain it followed at its start at the sweep after the brain was appended to',
    { timeout: 30_000 },
    async () => {
      const settings = await onSQLite();
      const { store } = await openedOn(settings);
      await brainCreated(store, 'alpha');
      await specRecorded(store, { name: 'close', version: 1, triggers: [closed] });
      const reacting = await reactingHost({ settings, appended: streamSignalOf(), sweepEveryMs: 20 });

      await published(store, { id: 'after', type: 'com.acme.closed' });
      const starts = await startsReaching(reacting, 1);

      expect(starts.map(({ brain, workflow }) => [brain, workflow])).toEqual([['alpha', 'close']]);
    },
  );

  it(
    'follows a brain its org creates from its first record, read from the registry the sweep names',
    { timeout: 30_000 },
    async () => {
      const reacting = await reactingHost({ appended: streamSignalOf(), sweepEveryMs: 20 });
      const { store } = reacting.database;

      await brainCreated(store, 'beta');
      await specRecorded(store, { name: 'close', version: 1, triggers: [closed] }, beta);
      await published(store, { id: 'first', type: 'com.acme.closed' }, {}, beta);
      const starts = await startsReaching(reacting, 1);

      expect(starts.map(({ brain, workflow }) => [brain, workflow])).toEqual([['beta', 'close']]);
    },
  );
});
