import { describe, expect, it } from 'vitest';

import { alpha, eventTrigger, published, recorded, specRecorded } from '../reaction-testing/brain-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';

describe('a record of a brain the follower cannot read', () => {
  it('is said and passed over, as an event, a fact of a run or a spec, while a workflow of the brain reacts', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await specRecorded(store, { name: 'watch', version: 1, trigger: eventTrigger({ type: 'com.acme.sentinel' }) });
    await recorded(store, `${alpha}events/bad`, { type: 'event_published', event: 'not an event' });
    await recorded(store, `${alpha}executions/r-bad`, { type: 'execution_started', name: 7 });
    await recorded(store, `${alpha}specs/orchestration`, { type: 'spec_created', name: 7 });

    await published(store, { id: 's1', type: 'com.acme.sentinel' });
    await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (starts) => starts.length > 0,
    );

    expect(reacting.notes()).toMatchObject([
      { kind: 'record_unreadable', org: 'acme', brain: 'alpha', type: 'event_published' },
      { kind: 'record_unreadable', org: 'acme', brain: 'alpha', type: 'execution_started' },
      { kind: 'record_unreadable', org: 'acme', brain: 'alpha', type: 'spec_created' },
    ]);
  });
});
