import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { Ledger, factOf, streamPrefixOfOrg, type Decider } from '@beonauto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';

const MalformedBrain = factOf('brain_created', Schema.Struct({ brain: Schema.Number }));

type Malformed = typeof MalformedBrain.Type;

const malformedRegistry: Decider<readonly Malformed[], Malformed, Malformed> = {
  initialState: [],
  evolve: (written, event) => [...written, event],
  decide: (event) => Result.succeed([event]),
  context: () => ({ by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' }),
  eventSchema: MalformedBrain,
};

export async function appendMalformedBrainEvent(fileName: string, org: string): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  await runtime.runPromise(
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.execute(`${streamPrefixOfOrg({ org })}brains`, malformedRegistry, {
        type: 'brain_created',
        data: { brain: 42 },
      });
    }),
  );
  await runtime.dispose();
}
