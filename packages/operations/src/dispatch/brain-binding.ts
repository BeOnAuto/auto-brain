import { Context, Effect } from 'effect';

import { BrainContext } from '../caller/brain-context.ts';
import { CallLineage } from '../caller/call-lineage.ts';
import { Caller } from '../caller/caller.ts';
import type { Registration } from '../definition/registration.ts';
import {
  brainBoundProjectionReader,
  brainBoundRecordedReader,
  brainBoundRunOutcomesReader,
  prefixedReader,
  prefixedWriter,
  streamPrefixOfBrain,
} from '../ledger/bound-ports.ts';
import { BrainReader } from '../ledger/brain-reader.ts';
import { BrainWriter } from '../ledger/brain-writer.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import type { BrainRequest } from './request.ts';

export function runInBrain(
  registration: Registration<'brain'>,
  { caller, org, brain, input, encoding, lineage, depth, callDepth, calledBy, trigger }: BrainRequest,
  ledger: LedgerPorts,
) {
  const prefix = streamPrefixOfBrain({ org, brain });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(BrainContext, { org, brain }),
    Context.add(BrainReader, {
      ...prefixedReader(ledger, prefix),
      ...brainBoundRecordedReader(ledger, { org, brain }),
      ...brainBoundRunOutcomesReader(ledger, { org, brain }),
      ...brainBoundProjectionReader(ledger, { org, brain }),
      readContent: (sha256) => ledger.content.get({ org, brain }, sha256),
    }),
  );
  const forCommands = forQueries.pipe(
    Context.add(BrainWriter, prefixedWriter(ledger, prefix)),
    Context.add(CallLineage, {
      lineage: lineage ?? null,
      depth: depth ?? 0,
      callDepth: callDepth ?? 0,
      calledBy: calledBy ?? null,
      trigger: trigger ?? null,
    }),
  );
  return registration.kind === 'query'
    ? registration.run(input, encoding).pipe(Effect.provideContext(forQueries))
    : registration.run(input, encoding).pipe(Effect.provideContext(forCommands));
}
