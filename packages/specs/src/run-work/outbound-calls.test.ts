import { Conflict, messageIdOf, type StreamWriter } from '@beonauto/operations';
import { memoryLedger } from '@beonauto/operations/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DeliveryStartedFact } from '../execution/execution-commands.ts';
import { executionDecider } from '../execution/execution-decider.ts';
import { brainBoundSettler } from '../execution/execution-settler.ts';
import { outboundCallRecorder } from './outbound-calls.ts';
import { executionEventOf, recordedRunIn, recordedRunInBrain } from './recorded-runs.ts';

const run = { org: 'acme', brain: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const stream = `brain/acme/alpha/executions/${run.id}`;

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const ofApproval = { primitive: 'interaction', name: 'approve-brief', spec_version: 1 };

const lineage = { causationId: 'request-1', correlationId: run.id };

async function aDeferredRun() {
  const ledger = memoryLedger();
  await Effect.runPromise(
    ledger.service.execute(stream, executionDecider, {
      ...ofApproval,
      type: 'start',
      input: { owner: 'ada' },
      calls_tools: false,
      finishes_later: true,
      ...fact,
    }),
  );
  await Effect.runPromise(
    ledger.service.execute(stream, executionDecider, {
      type: 'finish',
      result: { type: 'execution_deferred', record: { channel: 'inbox' } },
      ...fact,
    }),
  );
  return ledger;
}

function brainWriterOf(ledger: StreamWriter): StreamWriter {
  return {
    execute: (relative, decider, command, given) =>
      ledger.execute(`brain/acme/alpha/${relative}`, decider, command, given),
  };
}

describe('the outbound calls of a run', () => {
  it('are recorded as the brain itself, with the lineage they are given, answering the id of each', async () => {
    const ledger = await aDeferredRun();
    const record = outboundCallRecorder(ledger.service);

    const startedId = await Effect.runPromise(
      record(run, { type: 'delivery_started', number: 1, channel: 'inbox', target: 'ada' }, lineage),
    );
    const endedId = await Effect.runPromise(
      record(
        run,
        { type: 'delivery_ended', number: 1, outcome: 'delivered', duration_ms: 3 },
        { ...lineage, causationId: startedId },
      ),
    );
    const { records } = await Effect.runPromise(
      ledger.service.readRecorded(run, { kind: 'run', execution: run.id }, { order: 'asc', limit: 10 }),
    );

    expect([startedId, endedId]).toEqual([messageIdOf(stream, 3), messageIdOf(stream, 4)]);
    expect(
      records.slice(2).map(({ type, causationId, data }) => [type, causationId, executionEventOf(data)?.by]),
    ).toEqual([
      ['delivery_started', 'request-1', 'brain:alpha'],
      ['delivery_ended', startedId, 'brain:alpha'],
    ]);
  });

  it('are refused under a number another call took, and for a run the brain cannot hold', async () => {
    const ledger = await aDeferredRun();
    const record = outboundCallRecorder(ledger.service);
    const attempt: DeliveryStartedFact = { type: 'delivery_started', number: 1, channel: 'inbox', target: 'ada' };
    await Effect.runPromise(record(run, attempt, lineage));

    expect(await Effect.runPromise(Effect.result(record(run, attempt, lineage)))).toMatchObject(
      Result.fail({ _tag: 'conflict' }),
    );
    expect(await Effect.runPromise(Effect.result(record({ ...run, id: 'not-a-run' }, attempt, lineage)))).toEqual(
      Result.fail(new Conflict({ detail: 'There is no such run in this brain, so it records no work' })),
    );
  });
});

describe('a run as it was recorded', () => {
  it('is read by its address or by its id in its brain, and is nothing for a run there is not', async () => {
    const ledger = await aDeferredRun();
    const read = await Effect.runPromise(recordedRunIn(ledger.service, run));

    expect(read).toMatchObject({
      run: { execution_id: run.id, status: 'started', record: { channel: 'inbox' } },
      input: { owner: 'ada' },
      awaitsSettlement: true,
      lastCall: 0,
    });
    expect(await Effect.runPromise(recordedRunInBrain(brainReaderOf(ledger.service), run.id.toUpperCase()))).toEqual(
      read,
    );
    expect(await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: 'not-a-run' }))).toBeUndefined();
    expect(
      await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' })),
    ).toBeUndefined();
    expect(executionEventOf({ type: 'not_an_event' })).toBeUndefined();
  });
});

function brainReaderOf(ledger: Parameters<typeof recordedRunIn>[0]): Parameters<typeof recordedRunInBrain>[0] {
  return { load: (relative, decider) => ledger.load(`brain/acme/alpha/${relative}`, decider) };
}

describe('a settlement made through the writer of a brain', () => {
  it('settles a run of that brain by its id, and finds no run under an id that is not one', async () => {
    const ledger = await aDeferredRun();
    const settle = brainBoundSettler(brainWriterOf(ledger.service));

    expect(
      await Effect.runPromise(settle(run, { status: 'succeeded', output: { choice: 'approve' }, by: 'acme-admin' })),
    ).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(await Effect.runPromise(Effect.result(settle({ ...run, id: 'nope' }, { status: 'failed' })))).toMatchObject(
      Result.fail({ _tag: 'not_found' }),
    );
  });
});
