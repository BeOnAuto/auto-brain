import { Context, Effect } from 'effect';

import { PlaybookContext } from '../caller/brain-context.ts';
import { CallLineage } from '../caller/call-lineage.ts';
import { Caller } from '../caller/caller.ts';
import type { Registration } from '../definition/registration.ts';
import {
  playbookBoundProjectionReader,
  playbookBoundRecordedReader,
  playbookBoundRunOutcomesReader,
  prefixedReader,
  prefixedWriter,
  streamPrefixOfPlaybook,
} from '../ledger/bound-ports.ts';
import { PlaybookReader } from '../ledger/brain-reader.ts';
import { PlaybookWriter } from '../ledger/brain-writer.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import type { PlaybookRequest } from './request.ts';

export function runInPlaybook(
  registration: Registration<'playbook'>,
  { caller, org, playbook, input, encoding, lineage, depth, callDepth, calledBy, trigger }: PlaybookRequest,
  ledger: LedgerPorts,
) {
  const prefix = streamPrefixOfPlaybook({ org, playbook });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(PlaybookContext, { org, playbook }),
    Context.add(PlaybookReader, {
      ...prefixedReader(ledger, prefix),
      ...playbookBoundRecordedReader(ledger, { org, playbook }),
      ...playbookBoundRunOutcomesReader(ledger, { org, playbook }),
      ...playbookBoundProjectionReader(ledger, { org, playbook }),
      readContent: (sha256) => ledger.content.get({ org, playbook }, sha256),
    }),
  );
  const forCommands = forQueries.pipe(
    Context.add(PlaybookWriter, prefixedWriter(ledger, prefix)),
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
