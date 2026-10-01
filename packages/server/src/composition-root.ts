import { operationRoutes } from '@beonauto/api';
import { brainOperations, ledgerBrainDirectory } from '@beonauto/brains';
import { ledgerLayer } from '@beonauto/ledger';
import { IncidentReporter, makeCatalog, makeDispatcher, type DispatcherServices } from '@beonauto/operations';
import { Layer } from 'effect';

import { withoutOperations, type ServerOptions } from './lifecycle.ts';
import { logIncident } from './logging.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledgerFile: string): Layer.Layer<DispatcherServices> {
  const ledger = ledgerLayer({ fileName: ledgerFile });
  return Layer.mergeAll(ledger, ledgerBrainDirectory.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export const compositionRoot: ServerOptions<DispatcherServices> = {
  ...withoutOperations,
  runtimeLayer: ({ ledgerFile }) => applicationLayer(ledgerFile),
  routes: (runner) => [
    operationRoutes({ catalog: makeCatalog(brainOperations), dispatcher: makeDispatcher([]), runCall: runner.run }),
  ],
};
