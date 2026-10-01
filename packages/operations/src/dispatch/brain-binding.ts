import { Context, Effect } from 'effect';

import { BrainContext } from '../caller/brain-context.ts';
import { Caller } from '../caller/caller.ts';
import type { Registration } from '../definition/registration.ts';
import { prefixedReader, streamPrefixOfBrain, prefixedWriter } from '../ledger/bound-ports.ts';
import { BrainReader } from '../ledger/brain-reader.ts';
import { BrainWriter } from '../ledger/brain-writer.ts';
import type { StreamReader, StreamWriter } from '../ledger/stream-ports.ts';
import type { Succeeded, Rejected } from '../outcome/outcome.ts';
import type { BrainRequest } from './request.ts';

export function runInBrain(
  registration: Registration<'brain'>,
  { caller, org, brain, input, encoding }: BrainRequest,
  ledger: StreamReader & StreamWriter,
): Effect.Effect<Succeeded, Rejected> {
  const prefix = streamPrefixOfBrain({ org, brain });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(BrainContext, { org, brain }),
    Context.add(BrainReader, prefixedReader(ledger, prefix)),
  );
  return registration.kind === 'query'
    ? registration.run(input, encoding).pipe(Effect.provideContext(forQueries))
    : registration
        .run(input, encoding)
        .pipe(Effect.provideContext(forQueries.pipe(Context.add(BrainWriter, prefixedWriter(ledger, prefix)))));
}
