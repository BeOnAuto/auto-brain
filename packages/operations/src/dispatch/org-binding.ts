import { Context, Effect } from 'effect';

import { Caller } from '../caller/caller.ts';
import { OrgContext } from '../caller/org-context.ts';
import type { Registration } from '../definition/registration.ts';
import { prefixedReader, streamPrefixOfOrg, prefixedWriter } from '../ledger/bound-ports.ts';
import { OrgReader } from '../ledger/org-reader.ts';
import { OrgWriter } from '../ledger/org-writer.ts';
import type { StreamReader, StreamWriter } from '../ledger/stream-ports.ts';
import type { Succeeded, Rejected } from '../outcome/outcome.ts';
import type { OrgRequest } from './request.ts';

export function runInOrg(
  registration: Registration<'org'>,
  { caller, org, input, encoding }: OrgRequest,
  ledger: StreamReader & StreamWriter,
): Effect.Effect<Succeeded, Rejected> {
  const prefix = streamPrefixOfOrg({ org });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(OrgContext, { org }),
    Context.add(OrgReader, prefixedReader(ledger, prefix)),
  );
  return registration.kind === 'query'
    ? registration.run(input, encoding).pipe(Effect.provideContext(forQueries))
    : registration
        .run(input, encoding)
        .pipe(Effect.provideContext(forQueries.pipe(Context.add(OrgWriter, prefixedWriter(ledger, prefix)))));
}
