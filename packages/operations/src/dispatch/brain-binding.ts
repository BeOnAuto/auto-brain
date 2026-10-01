import { Context, Effect } from 'effect';

import { BrainScope } from '../caller/brain-scope.ts';
import { Caller } from '../caller/caller.ts';
import type { Registration } from '../definition/registration.ts';
import { readerWithin, streamPrefixOfBrain, writerWithin } from '../ledger/bound-ports.ts';
import { BrainReader } from '../ledger/brain-reader.ts';
import { BrainWriter } from '../ledger/brain-writer.ts';
import type { StreamReader, StreamWriter } from '../ledger/stream-ports.ts';
import type { Done, Refused } from '../outcome/outcome.ts';
import type { BrainRequest } from './request.ts';

export function runInBrain(
  registration: Registration<'brain'>,
  { caller, org, brain, input, form }: BrainRequest,
  ledger: StreamReader & StreamWriter,
): Effect.Effect<Done, Refused> {
  const prefix = streamPrefixOfBrain({ org, brain });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(BrainScope, { org, brain }),
    Context.add(BrainReader, readerWithin(ledger, prefix)),
  );
  return registration.kind === 'query'
    ? registration.run(input, form).pipe(Effect.provideContext(forQueries))
    : registration
        .run(input, form)
        .pipe(Effect.provideContext(forQueries.pipe(Context.add(BrainWriter, writerWithin(ledger, prefix)))));
}
