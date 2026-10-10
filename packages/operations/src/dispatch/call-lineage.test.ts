import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { BrainWriter, CallLineage, defineCommand, factOf, messageIdOf, type Decider } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';

const NotedSchema = factOf('noted', Schema.Struct({}));

const notes: Decider<null, null, typeof NotedSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: () => Result.succeed([{ type: 'noted', data: {} }]),
  context: () => ({ at: '2026-10-05T09:00:00.000Z', by: 'tester' }),
  eventSchema: NotedSchema,
};

const note = defineCommand('brain', {
  name: 'note',
  title: 'Note',
  description: 'Notes that it was called, with the lineage the call was given.',
  route: { method: 'POST', path: '/notes' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({
    version: Schema.Int,
    depth: Schema.Int,
    callDepth: Schema.Int,
    calledBy: Schema.NullOr(Schema.Struct({ run_id: Schema.String, reference: Schema.String, run: Schema.Int })),
    trigger: Schema.NullOr(
      Schema.Struct({ kind: Schema.Literals(['event', 'cron', 'every']), reference: Schema.String }),
    ),
  }),
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* () {
    const { lineage, depth, callDepth, calledBy, trigger } = yield* CallLineage;
    const { version } = yield* (yield* BrainWriter).execute('notes', notes, null, lineage ?? undefined);
    return { version, depth, callDepth, calledBy, trigger };
  }),
});

const toAlpha = toBrain('acme', 'alpha');

describe('the lineage of a call', () => {
  it('reaches a brain command as a service, which writes it beside its events, and is null when none was given', async () => {
    const { dispatcher, ledger, run } = harness();
    const lineage = { causationId: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3', correlationId: 'root' };
    await run(dispatcher.dispatchToBrain(note.registration, { ...toAlpha(acmeAdmin), lineage }));
    await run(dispatcher.dispatchToBrain(note.registration, toAlpha(acmeAdmin)));

    const { records } = await Effect.runPromise(
      ledger.service.readRecorded({ org: 'acme', brain: 'alpha' }, { kind: 'everything' }, { order: 'asc', limit: 10 }),
    );

    expect(records.map(({ id, causationId, correlationId }) => ({ id, causationId, correlationId }))).toEqual([
      { id: messageIdOf('brain/acme/alpha/notes', 1), ...lineage },
      { id: messageIdOf('brain/acme/alpha/notes', 2), causationId: null, correlationId: null },
    ]);
  });

  it('carries the reaction depth the request was given, and 0 for a request that gave none', async () => {
    const { dispatcher, run } = harness();

    const outcomes = [
      await run(dispatcher.dispatchToBrain(note.registration, { ...toAlpha(acmeAdmin), depth: 3 })),
      await run(dispatcher.dispatchToBrain(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { version: 1, depth: 3 } },
      { status: 'succeeded', output: { version: 2, depth: 0 } },
    ]);
  });

  it('carries how many calls are above the run and the call it answers, and none for a request that gave none', async () => {
    const { dispatcher, run } = harness();
    const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', reference: '/do/0/ask', run: 2 };

    const outcomes = [
      await run(dispatcher.dispatchToBrain(note.registration, { ...toAlpha(acmeAdmin), callDepth: 2, calledBy })),
      await run(dispatcher.dispatchToBrain(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toEqual([
      { status: 'succeeded', output: { version: 1, depth: 0, callDepth: 2, calledBy, trigger: null } },
      { status: 'succeeded', output: { version: 2, depth: 0, callDepth: 0, calledBy: null, trigger: null } },
    ]);
  });
});

describe('the lineage of a run a trigger started', () => {
  it('carries the trigger that started the run, and none for a request that gave none', async () => {
    const { dispatcher, run } = harness();
    const trigger = { kind: 'every' as const, reference: '/schedule/every' };

    const outcomes = [
      await run(dispatcher.dispatchToBrain(note.registration, { ...toAlpha(acmeAdmin), trigger })),
      await run(dispatcher.dispatchToBrain(note.registration, toAlpha(acmeAdmin))),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { version: 1, trigger } },
      { status: 'succeeded', output: { version: 2, trigger: null } },
    ]);
  });
});
