import { Effect, Exit, Schema } from 'effect';

import type { RequestLedger } from '../schedule/request-ledger.ts';
import type { AskedRequest } from './asked-requests.ts';
import { dueInBothLanes } from './harness-parts.ts';

const isWork = Schema.is(Schema.Struct({ command: Schema.Struct({ type: Schema.Literal('work') }) }));

function stoppingBeforeSettling(ledger: RequestLedger): RequestLedger {
  return {
    ...ledger,
    execute: (stream, decider, command, lineage) =>
      isWork(command)
        ? ledger.execute(stream, decider, command, lineage)
        : Effect.die(new Error('The server stopped before it settled the run')),
  };
}

export async function attemptedThenStopped({ brain, askedAt }: AskedRequest): Promise<boolean> {
  const stopping = brain.dueOver(stoppingBeforeSettling(brain.ledger.service));
  const items = await dueInBothLanes(stopping, askedAt);
  const exit = await Effect.runPromise(Effect.exit(Effect.forEach(items, (item) => item.perform(askedAt))));
  return Exit.isFailure(exit);
}
