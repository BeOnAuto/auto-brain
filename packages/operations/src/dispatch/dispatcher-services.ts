import { Context, Effect } from 'effect';

import { PlaybookRegistry } from '../ledger/brain-registry.ts';
import { Ledger } from '../ledger/ledger.ts';
import { IncidentReporter } from './incident-reporter.ts';

export type DispatcherServices = Ledger | PlaybookRegistry | IncidentReporter;

export const withoutDispatcherServices = Effect.updateContext<never, never>(
  Context.omit(Ledger, PlaybookRegistry, IncidentReporter),
);
