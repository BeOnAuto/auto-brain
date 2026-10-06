import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { statement } from '../database/statement.ts';
import { published, publishedInTurn } from '../reaction-testing/brain-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';

const waiting = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function listening(filter: string, input: Readonly<Record<string, string>> = {}) {
  return startOf(workflow(`do:\n  - await: { listen: { to: { one: { with: ${filter} } } } }`), input);
}

function stateOf({ host }: ReactingHost, executionId = waiting) {
  return Effect.runPromise(host.stateOf(runAt(executionId)));
}

function ended(reacting: ReactingHost, executionId = waiting) {
  return until(
    () => stateOf(reacting, executionId),
    (state) => state.status === 'ended',
  );
}

describe('a run that waits for an event whose type its filter names', () => {
  it('takes an event published to its brain, from among events meant for other runs', { timeout: 30_000 }, async () => {
    const reacting = await reactingHost();
    await Effect.runPromise(reacting.host.start(runAt(waiting), listening('{ type: com.acme.decided }')));
    const others = Array.from({ length: 65 }, (_, index) => ({ id: `other-${index}`, type: 'com.acme.other' }));
    await publishedInTurn(reacting.database.store, others);

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.decided', data: { approved: true } });
    const state = await ended(reacting);

    expect(state.outcome).toEqual({ kind: 'completed', output: [{ approved: true }] });
    expect(state.inbox).toMatchObject({ waiting: [], received: 1 });
  });

  it('correlates through its own variables: the host offers the event, and the run takes only its own', async () => {
    const reacting = await reactingHost();
    const filter = "{ type: com.acme.decided, data: '${ .ticket == $workflow.input.ticket }' }";
    await Effect.runPromise(reacting.host.start(runAt(waiting), listening(filter, { ticket: 't-7' })));

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.decided', data: { ticket: 't-8' } });
    await published(reacting.database.store, { id: 'e2', type: 'com.acme.decided', data: { ticket: 't-7' } });
    const state = await ended(reacting);

    expect(state.outcome).toEqual({ kind: 'completed', output: [{ ticket: 't-7' }] });
    expect(state.inbox.offeredIds).toHaveLength(1);
  });
});

describe('an offer to a run that waits for an event', () => {
  it('is said when the filter of the run fails on it, and not taken', async () => {
    const reacting = await reactingHost();
    const filter = "{ type: com.acme.decided, data: '${ .ticket == $workflow.input.ticket }' }";
    await Effect.runPromise(reacting.host.start(runAt(waiting), listening(filter, { ticket: 't-7' })));

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.decided', data: 'not a ticket' });
    await published(reacting.database.store, { id: 'e2', type: 'com.acme.decided', data: { ticket: 't-7' } });
    await ended(reacting);

    expect(reacting.notes()).toMatchObject([{ kind: 'offer_declined', run: runAt(waiting) }]);
  });

  it('is not made of an event the run emitted itself', async () => {
    const reacting = await reactingHost();
    await Effect.runPromise(reacting.host.start(runAt(waiting), listening('{ type: com.acme.decided }')));

    await published(
      reacting.database.store,
      { id: 'own', type: 'com.acme.decided' },
      { emitted_by: { execution_id: waiting, workflow: 'test', version: 1 }, depth: 1 },
    );
    await published(reacting.database.store, { id: 'theirs', type: 'com.acme.decided', data: 'theirs' });
    const state = await ended(reacting);

    expect(state.outcome).toEqual({ kind: 'completed', output: ['theirs'] });
  });
});

describe('a run that listened before the host kept its listeners', () => {
  it('is listened for again when the host next starts, and takes the event', async () => {
    const first = await reactingHost();
    await Effect.runPromise(first.host.start(runAt(waiting), listening('{ type: com.acme.decided }')));
    await until(
      () => Effect.runPromise(first.database.read(statement`SELECT run_id FROM workflow_listeners`)),
      (rows) => rows.length > 0,
    );
    await first.host.stop();
    await Effect.runPromise(
      Effect.all([
        first.database.write(statement`DELETE FROM workflow_listener_types`),
        first.database.write(statement`DELETE FROM workflow_listeners`),
        first.database.write(statement`DELETE FROM workflow_followed_scans`),
        first.database.write(
          statement`INSERT INTO workflow_runs (run_id, stream_id) VALUES (${'acme/alpha/bare'}, ${'s'})`,
        ),
      ]),
    );

    const second = await reactingHost({ settings: first.settings });
    await published(second.database.store, { id: 'e1', type: 'com.acme.decided', data: 'decided' });
    const state = await ended(second);

    expect(state.outcome).toEqual({ kind: 'completed', output: ['decided'] });
  });
});
