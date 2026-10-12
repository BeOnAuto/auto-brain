import { IncidentReporter, type DispatcherServices, type Ledger } from '@on.auto/operations';
import { ledgerPlaybookRegistry } from '@on.auto/playbooks';
import { Layer } from 'effect';

import { logIncident } from '../logging/logging.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerPlaybookRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}
