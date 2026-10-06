import { BrainContext, BrainWriter, Caller, messageIdOf, type Lineage, type RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain, type Harness } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';
import { answerOfCall, toolUser } from '../testing/tool-user.ts';
import { toolCallJournal } from './tool-call-journal.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const stream = `brain/acme/alpha/${executionStreamOf(executionId)}`;

const idAt = (position: number): string => messageIdOf(stream, position);

interface Linked {
  readonly type: string;
  readonly id: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
}

function linksOf({ type, id, causationId, correlationId }: RecordedEvent): Linked {
  return { type, id, causationId, correlationId };
}

async function linksIn({ ledger, run }: Harness): Promise<readonly Linked[]> {
  const { records } = await run(
    Effect.orDie(
      ledger.service.readRecorded(
        { org: 'acme', brain: 'alpha' },
        { kind: 'run', execution: executionId },
        { order: 'asc', limit: 100 },
      ),
    ),
  );
  return records.map((record) => linksOf(record));
}

async function aToolUser() {
  const user = toolUser();
  const operations = specOperationsFor([user.primitive]);
  const specs = harness();
  await specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'tool-user', name: 'caller', source: 'x' }));
  const executing = (input: object, lineage?: Lineage) =>
    specs.call(operations.executeSpec, {
      ...toAlpha(acmeAdmin, { primitive: 'tool-user', name: 'caller', input, execution_id: executionId }),
      ...(lineage === undefined ? {} : { lineage }),
    });
  return { ...specs, executing };
}

describe('the lineage of a run that calls tools', () => {
  it('starts with no cause, links each call to the answer before it and each answer to its call, and the finish to the last answer', async () => {
    const specs = await aToolUser();
    await specs.executing({ calls: 2 });

    expect(await linksIn(specs)).toEqual([
      { type: 'execution_started', id: idAt(1), causationId: null, correlationId: executionId },
      { type: 'tool_call_started', id: idAt(2), causationId: idAt(1), correlationId: executionId },
      { type: 'tool_call_started', id: idAt(3), causationId: idAt(1), correlationId: executionId },
      { type: 'tool_call_answered', id: idAt(4), causationId: idAt(2), correlationId: executionId },
      { type: 'tool_call_answered', id: idAt(5), causationId: idAt(3), correlationId: executionId },
      { type: 'execution_succeeded', id: idAt(6), causationId: idAt(5), correlationId: executionId },
    ]);
  });

  it('finishes caused by its start when it called no tool, and a failure too', async () => {
    const specs = await aToolUser();
    await specs.executing({ calls: 0, ending: 'unavailable' });

    expect((await linksIn(specs)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['execution_started', null],
      ['execution_rejected', idAt(1)],
    ]);
  });

  it('started by another run, is caused by what it was given and belongs to the run it was given', async () => {
    const specs = await aToolUser();
    const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: 'root' };
    await specs.executing({ calls: 0 }, lineage);

    expect((await linksIn(specs)).map(({ causationId, correlationId }) => [causationId, correlationId])).toEqual([
      [lineage.causationId, 'root'],
      [idAt(1), 'root'],
    ]);
  });

  it('is never taken from the input of execute_spec, which refuses a field it does not know', async () => {
    const specs = await aToolUser();
    const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: 'root' };

    expect(await specs.executing({ calls: 0, lineage })).toMatchObject({ status: 'succeeded' });
    expect(
      await specs.call(
        specOperationsFor([toolUser().primitive]).executeSpec,
        toAlpha(acmeAdmin, { primitive: 'tool-user', name: 'caller', input: { calls: 0 }, lineage }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/lineage' }] });
  });
});

describe('the journal of a run, given an answer to a call it has no start of', () => {
  it('links the answer to the answer before it, or to the start of the run', async () => {
    const specs = harness();
    const recording = Effect.gen(function* () {
      yield* specs.ledger.service.execute(stream, executionDecider, {
        type: 'start',
        primitive: 'tool-user',
        name: 'caller',
        input: {},
        spec_version: 1,
        calls_tools: true,
        by: 'acme-admin',
        at: '2026-10-01T09:00:00.000Z',
      });
      const journal = yield* toolCallJournal(executionId, { startId: idAt(1), correlationId: executionId });
      return yield* journal.record(answerOfCall(9));
    }).pipe(
      Effect.provideService(BrainWriter, {
        execute: (relative, decider, command, lineage) =>
          specs.ledger.service.execute(`brain/acme/alpha/${relative}`, decider, command, lineage),
      }),
      Effect.provideService(Caller, acmeAdmin),
      Effect.provideService(BrainContext, { org: 'acme', brain: 'alpha' }),
    );

    expect(await specs.run(Effect.orDie(recording))).toBe(true);
    expect((await linksIn(specs)).at(-1)).toEqual({
      type: 'tool_call_answered',
      id: idAt(2),
      causationId: idAt(1),
      correlationId: executionId,
    });
  });
});

describe('the lineage of a run that finishes later', () => {
  it('defers caused by its start, and settles caused by what settled it', async () => {
    const specs = await withHandOn();
    await specs.executing();
    const settledBy = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };
    await specs.settling({ status: 'succeeded', output: 'done', record: {} }, undefined, settledBy);

    expect((await linksIn(specs)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['execution_started', null],
      ['execution_deferred', idAt(1)],
      ['execution_succeeded', settledBy.causationId],
    ]);
  });

  it('started again after it was rejected, is caused by its latest start from then on', async () => {
    const specs = await aToolUser();
    await specs.executing({ calls: 0, ending: 'unavailable' });
    await specs.executing({ calls: 0, ending: 'unavailable' });

    expect((await linksIn(specs)).map(({ type, causationId }) => [type, causationId])).toEqual([
      ['execution_started', null],
      ['execution_rejected', idAt(1)],
      ['execution_started', null],
      ['execution_rejected', idAt(3)],
    ]);
  });
});
