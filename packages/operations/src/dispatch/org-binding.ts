import { Context, Effect } from 'effect';

import { Caller } from '../caller/caller.ts';
import { OrgScope } from '../caller/org-scope.ts';
import type { Registration } from '../definition/registration.ts';
import { readerWithin, streamPrefixOfOrg, writerWithin } from '../ledger/bound-ports.ts';
import { OrgReader } from '../ledger/org-reader.ts';
import { OrgWriter } from '../ledger/org-writer.ts';
import type { StreamReader, StreamWriter } from '../ledger/stream-ports.ts';
import type { Succeeded, Rejected } from '../outcome/outcome.ts';
import type { OrgRequest } from './request.ts';

export function runInOrg(
  registration: Registration<'org'>,
  { caller, org, input, form }: OrgRequest,
  ledger: StreamReader & StreamWriter,
): Effect.Effect<Succeeded, Rejected> {
  const prefix = streamPrefixOfOrg({ org });
  const forQueries = Context.make(Caller, caller).pipe(
    Context.add(OrgScope, { org }),
    Context.add(OrgReader, readerWithin(ledger, prefix)),
  );
  return registration.kind === 'query'
    ? registration.run(input, form).pipe(Effect.provideContext(forQueries))
    : registration
        .run(input, form)
        .pipe(Effect.provideContext(forQueries.pipe(Context.add(OrgWriter, writerWithin(ledger, prefix)))));
}
