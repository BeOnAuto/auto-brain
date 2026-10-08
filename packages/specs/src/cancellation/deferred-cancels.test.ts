import { Conflict, type StreamReader, type StreamWriter } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { deferredCanceller, definePrimitive, outboundCallRecorder, type Primitive } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { relay } from '../testing/relay.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const relayed = { org: 'acme', brain: 'alpha', id: relayedId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };

const asked = { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' } as const;

function relayDeciding(cancel: Primitive['cancel']): Primitive {
  return definePrimitive({
    name: 'relay',
    title: 'Relay',
    guide: { name: 'relay' },
    noun: { one: 'relay', other: 'relays' },
    describeOutput: () => 'It handed its input on.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    execute: () => Effect.succeed({ finishesLater: true, record: {} }),
    cancel,
  });
}

describe('a cancel of a run of another capability that finishes later', () => {
  it('settles the run as its capability decides from what the run recorded, by whoever asked', async () => {
    const { executing, ledger, reading } = await withHandOn();
    await executing();
    const deciding = relayDeciding(({ record, kind }) => ({
      status: 'rejected',
      reason: 'cancelled',
      kind,
      detail: `Stopped what was handed on as ${JSON.stringify(record)}`,
    }));

    await Effect.runPromise(deferredCanceller([deciding], ledger.service)(relayed, asked, lineage));

    expect(await reading()).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'cancelled',
          kind: 'requested',
          detail: `Stopped what was handed on as {"handed_on":"${relayedId}"}`,
        },
      },
    });
  });

  it('settles it as cancelled with the kind and reason asked when its capability has no hook of its own, or is not served', async () => {
    const served = await withHandOn();
    await served.executing();
    const gone = await withHandOn();
    await gone.executing();

    await Effect.runPromise(deferredCanceller([relay().primitive], served.ledger.service)(relayed, asked, lineage));
    await Effect.runPromise(
      deferredCanceller([], gone.ledger.service)(relayed, { ...asked, kind: 'parent_ended' }, lineage),
    );

    expect([await served.reading(), await gone.reading()]).toMatchObject([
      { output: { rejection: { reason: 'cancelled', kind: 'requested', detail: asked.reason } } },
      { output: { rejection: { reason: 'cancelled', kind: 'parent_ended', detail: asked.reason } } },
    ]);
  });
});

describe('a cancel of a run of another capability, as asked', () => {
  it('settles it by the brain itself when the request names no actor', async () => {
    const { executing, ledger, run } = await withHandOn();
    await executing();

    await Effect.runPromise(
      deferredCanceller([], ledger.service)(relayed, { kind: 'deadline', reason: 'Out of time' }, lineage),
    );
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded(
          { org: 'acme', brain: 'alpha' },
          { kind: 'everything' },
          { order: 'asc', limit: 20 },
        ),
      ),
    );

    expect(records.at(-1)?.data).toMatchObject({ type: 'execution_rejected', by: 'brain:alpha' });
  });
});

describe('a cancel its capability settles otherwise', () => {
  it('settles it as its capability decides, by the actor the decision names rather than whoever asked', async () => {
    const { executing, ledger, run } = await withHandOn();
    await executing();
    const answering = relayDeciding(({ channelAnswer, deliveredAt }) => ({
      status: 'succeeded',
      output: { delivered: JSON.stringify({ channelAnswer, deliveredAt }) },
      record: {},
      by: 'channel:partner',
    }));

    await Effect.runPromise(deferredCanceller([answering], ledger.service)(relayed, asked, lineage));
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded(
          { org: 'acme', brain: 'alpha' },
          { kind: 'everything' },
          { order: 'asc', limit: 20 },
        ),
      ),
    );

    expect(records.at(-1)?.data).toMatchObject({
      type: 'execution_succeeded',
      output: { delivered: JSON.stringify({ channelAnswer: null, deliveredAt: null }) },
      by: 'channel:partner',
    });
  });
});

describe('a cancel of a run of another capability, as asked, when its hook breaks', () => {
  it('fails the run when its capability’s hook throws', async () => {
    const { executing, ledger, reading } = await withHandOn();
    await executing();
    const throwing = relayDeciding(() => {
      throw new Error('The hook broke');
    });

    await Effect.runPromise(deferredCanceller([throwing], ledger.service)(relayed, asked, lineage));

    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});

describe('a cancel of a run of another capability that is over', () => {
  it('does nothing for a run that has ended, and for one the brain does not have', async () => {
    const { executing, ledger, reading, settling } = await withHandOn();
    await executing();
    await settling({ status: 'succeeded', output: 'handed on', record: {} });
    const cancel = deferredCanceller([relay().primitive], ledger.service);

    await Effect.runPromise(cancel(relayed, asked, lineage));
    await Effect.runPromise(cancel({ ...relayed, id: '0199a3c4-7d2e-7c1a-9b3f-00000000ffff' }, asked, lineage));

    expect(await reading()).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('takes a run that ended between the read and the settlement as done, and fails on any other conflict', async () => {
    const { executing, ledger } = await withHandOn();
    await executing();
    const changed = new Conflict({
      detail: 'The state changed while the command was decided',
      kind: 'concurrent_change',
    });
    const endedMeanwhile = {
      ...ledger.service,
      execute: () => Effect.fail(new Conflict({ detail: 'The run already ended with another result' })),
    };
    const changedMeanwhile = { ...ledger.service, execute: () => Effect.fail(changed) };

    await Effect.runPromise(deferredCanceller([], endedMeanwhile)(relayed, asked, lineage));

    expect(await Effect.runPromise(Effect.flip(deferredCanceller([], changedMeanwhile)(relayed, asked, lineage)))).toBe(
      changed,
    );
  });
});

const decidingFromDelivery = relayDeciding(({ deliveredAt }) =>
  deliveredAt === null
    ? { status: 'rejected', reason: 'cancelled', kind: 'requested', detail: 'Nothing was delivered' }
    : { status: 'succeeded', output: { delivered: 'delivered' } },
);

describe('a cancel whose run changes between its read and its settlement', () => {
  it('reads the run again and lets its capability decide from what the run holds now', async () => {
    const { executing, ledger, reading } = await withHandOn();
    await executing();
    const record = outboundCallRecorder(ledger.service);
    const delivered = Effect.all([
      record(relayed, { type: 'delivery_started', number: 1, channel: 'partner', target: 'ada' }, lineage),
      record(relayed, { type: 'delivery_ended', number: 1, outcome: 'delivered', duration_ms: 3 }, lineage),
    ]);
    const turns = { next: (): Effect.Effect<unknown, unknown> => delivered };
    const changedOnce: StreamReader & StreamWriter = {
      ...ledger.service,
      execute: (stream, decider, command, given) => {
        const turn = Effect.orDie(turns.next());
        turns.next = () => Effect.void;
        return Effect.andThen(turn, ledger.service.execute(stream, decider, command, given));
      },
    };
    await Effect.runPromise(deferredCanceller([decidingFromDelivery], changedOnce)(relayed, asked, lineage));

    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: { delivered: 'delivered' } } });
  });
});

describe('a cancel of a run whose start says it finishes later, before it recorded its deferral', () => {
  it('lets its capability decide from an empty record', async () => {
    const starting = Promise.withResolvers<void>();
    const pending = definePrimitive({
      name: 'pending',
      title: 'Pending',
      guide: { name: 'pending' },
      noun: { one: 'pending run', other: 'pending runs' },
      describeOutput: () => 'It is pending.',
      mediaType: 'text/plain',
      parse: (source: string) => Effect.succeed(source),
      summarize: () => ({}),
      finishesLater: true,
      execute: () => Effect.andThen(Effect.sync(starting.resolve), Effect.never),
      cancel: ({ record, kind }) => ({ status: 'rejected', reason: 'cancelled', kind, detail: JSON.stringify(record) }),
    });
    const operations = specOperationsFor([pending]);
    const specs = harness();
    const toAlpha = toBrain('acme', 'alpha');
    await specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'pending', name: 'slow', source: 'x' }));
    void specs.call(
      operations.executeSpec,
      toAlpha(acmeAdmin, { primitive: 'pending', name: 'slow', execution_id: relayedId }),
    );
    await starting.promise;

    await Effect.runPromise(deferredCanceller([pending], specs.ledger.service)(relayed, asked, lineage));

    expect(await specs.call(operations.getExecution, toAlpha(acmeAdmin, { execution_id: relayedId }))).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', detail: '{}' } },
    });
  });
});
