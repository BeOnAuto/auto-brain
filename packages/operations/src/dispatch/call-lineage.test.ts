import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { BrainWriter, CallLineage, defineCommand, messageIdOf, type Decider } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';

const NotedSchema = Schema.Struct({ type: Schema.Literal('noted') });

const notes: Decider<null, null, typeof NotedSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: () => Result.succeed([{ type: 'noted' }]),
  eventSchema: NotedSchema,
};

const note = defineCommand('brain', {
  name: 'note',
  title: 'Note',
  description: 'Notes that it was called, with the lineage the call was given.',
  route: { method: 'POST', path: '/notes' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ version: Schema.Int }),
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* () {
    const { lineage } = yield* CallLineage;
    const { version } = yield* (yield* BrainWriter).execute('notes', notes, null, lineage ?? undefined);
    return { version };
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
});
