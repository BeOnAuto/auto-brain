import { Effect } from 'effect';

import type { Runnable } from '../definition/registration.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import type { Rejected, Succeeded } from '../outcome/outcome.ts';
import { playbookServicesOf } from './playbook-services.ts';
import type { PlaybookRequest } from './request.ts';

export function runInPlaybook<A extends Succeeded>(
  registration: Runnable<'playbook', A>,
  request: PlaybookRequest,
  ledger: LedgerPorts,
): Effect.Effect<A, Rejected> {
  const { forQueries, forCommands } = playbookServicesOf(request, ledger);
  const { input, encoding, body } = request;
  return registration.kind === 'query'
    ? registration.run(input, encoding, body).pipe(Effect.provideContext(forQueries))
    : registration.run(input, encoding, body).pipe(Effect.provideContext(forCommands));
}
