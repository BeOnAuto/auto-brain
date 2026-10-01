import { Context, Effect } from 'effect';

import { readerWithin, streamPrefixOfOrg, writerWithin } from './bound-ports.ts';
import { Caller } from './caller.ts';
import { OrgReader } from './org-reader.ts';
import { OrgScope } from './org-scope.ts';
import { OrgWriter } from './org-writer.ts';
import type { Done, Refused } from './outcome.ts';
import type { Registration } from './registration.ts';
import type { OrgRequest } from './request.ts';
import type { StreamReader, StreamWriter } from './stream-ports.ts';

export function runInOrg(
  registration: Registration<'org'>,
  { caller, org, input, form }: OrgRequest,
  ledger: StreamReader & StreamWriter,
): Effect.Effect<Done, Refused> {
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
