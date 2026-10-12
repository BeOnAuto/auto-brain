import { Effect } from 'effect';

import type { Runnable } from '../definition/registration.ts';
import type { LedgerPorts } from '../ledger/ledger.ts';
import type { Rejected, Succeeded } from '../outcome/outcome.ts';
import { brainServicesOf } from './brain-services.ts';
import type { BrainRequest } from './request.ts';

export function runInBrain<A extends Succeeded>(
  registration: Runnable<'brain', A>,
  request: BrainRequest,
  ledger: LedgerPorts,
): Effect.Effect<A, Rejected> {
  const { forQueries, forCommands } = brainServicesOf(request, ledger);
  const { input, encoding, body } = request;
  return registration.kind === 'query'
    ? registration.run(input, encoding, body).pipe(Effect.provideContext(forQueries))
    : registration.run(input, encoding, body).pipe(Effect.provideContext(forCommands));
}
