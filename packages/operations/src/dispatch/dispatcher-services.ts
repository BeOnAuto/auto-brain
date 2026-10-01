import { Context, Effect } from 'effect';

import { BrainDirectory } from '../ledger/brain-directory.ts';
import { Ledger } from '../ledger/ledger.ts';
import { IncidentReporter } from './incident-reporter.ts';

export type DispatcherServices = Ledger | BrainDirectory | IncidentReporter;

export const withoutDispatcherServices = Effect.updateContext<never, never>(
  Context.omit(Ledger, BrainDirectory, IncidentReporter),
);
