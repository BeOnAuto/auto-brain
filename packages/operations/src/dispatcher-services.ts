import { Context, Effect } from 'effect';

import { BrainDirectory } from './brain-directory.ts';
import { IncidentReporter } from './incident-reporter.ts';
import { Ledger } from './ledger.ts';

export type DispatcherServices = Ledger | BrainDirectory | IncidentReporter;

export const withoutDispatcherServices = Effect.updateContext<never, never>(
  Context.omit(Ledger, BrainDirectory, IncidentReporter),
);
