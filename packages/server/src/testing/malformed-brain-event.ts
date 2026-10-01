import { ledgerLayer } from '@beonauto/ledger';
import { Ledger, streamPrefixOfOrg, type Decider } from '@beonauto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';

const MalformedBrain = Schema.Struct({ type: Schema.Literal('brain_created'), brain: Schema.Number });

type Malformed = typeof MalformedBrain.Type;

const malformedRegistry: Decider<readonly Malformed[], Malformed, Malformed> = {
  initialState: [],
  evolve: (written, event) => [...written, event],
  decide: (event) => Result.succeed([event]),
  eventSchema: MalformedBrain,
};

export async function appendMalformedBrainEvent(fileName: string, org: string): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  await runtime.runPromise(
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.execute(`${streamPrefixOfOrg({ org })}brains`, malformedRegistry, {
        type: 'brain_created',
        brain: 42,
      });
    }),
  );
  await runtime.dispose();
}
