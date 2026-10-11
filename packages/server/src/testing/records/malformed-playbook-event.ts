import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { Ledger, streamPrefixOfOrg, type Decider } from '@beonauto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';

const MalformedPlaybook = Schema.Struct({ type: Schema.Literal('playbook_created'), playbook: Schema.Number });

type Malformed = typeof MalformedPlaybook.Type;

const malformedRegistry: Decider<readonly Malformed[], Malformed, Malformed> = {
  initialState: [],
  evolve: (written, event) => [...written, event],
  decide: (event) => Result.succeed([event]),
  eventSchema: MalformedPlaybook,
};

export async function appendMalformedPlaybookEvent(fileName: string, org: string): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  await runtime.runPromise(
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      yield* ledger.execute(`${streamPrefixOfOrg({ org })}playbooks`, malformedRegistry, {
        type: 'playbook_created',
        playbook: 42,
      });
    }),
  );
  await runtime.dispose();
}
