import { Context, Effect } from 'effect';

import { BrainContext } from '../caller/brain-context.ts';
import { CallLineage } from '../caller/call-lineage.ts';
import { Caller } from '../caller/caller.ts';
import type { Registration } from '../definition/registration.ts';
import {
  brainBoundRecordedReader,
  prefixedReader,
  prefixedWriter,
  streamPrefixOfBrain,
} from '../ledger/bound-ports.ts';
import { BrainReader } from '../ledger/brain-reader.ts';
import { BrainWriter } from '../ledger/brain-writer.ts';
import type { RecordedReader, StreamReader, StreamWriter } from '../ledger/stream-ports.ts';
import type { BrainRequest } from './request.ts';

export function runInBrain(
  registration: Registration<'brain'>,
  { caller, org, brain, input, encoding, lineage }: BrainRequest,
  ledger: StreamReader & StreamWriter & RecordedReader,
) {
  const prefix = streamPrefixOfBrain({ org, brain });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(BrainContext, { org, brain }),
    Context.add(BrainReader, {
      ...prefixedReader(ledger, prefix),
      ...brainBoundRecordedReader(ledger, { org, brain }),
    }),
  );
  const forCommands = forQueries.pipe(
    Context.add(BrainWriter, prefixedWriter(ledger, prefix)),
    Context.add(CallLineage, { lineage: lineage ?? null }),
  );
  return registration.kind === 'query'
    ? registration.run(input, encoding).pipe(Effect.provideContext(forQueries))
    : registration.run(input, encoding).pipe(Effect.provideContext(forCommands));
}
