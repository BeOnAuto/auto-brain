import { Context, Effect } from 'effect';

import { readerWithin, streamPrefixOfBrain, writerWithin } from './bound-ports.ts';
import { BrainReader } from './brain-reader.ts';
import { BrainScope } from './brain-scope.ts';
import { BrainWriter } from './brain-writer.ts';
import { Caller } from './caller.ts';
import type { Done, Refused } from './outcome.ts';
import type { Registration } from './registration.ts';
import type { BrainRequest } from './request.ts';
import type { StreamReader, StreamWriter } from './stream-ports.ts';

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
