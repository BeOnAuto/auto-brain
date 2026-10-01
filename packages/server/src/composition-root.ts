import { operationRoutes } from '@beonauto/api';
import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { ledgerLayer } from '@beonauto/ledger';
import { IncidentReporter, makeCatalog, makeDispatcher, type DispatcherServices } from '@beonauto/operations';
import { Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from './lifecycle.ts';
import { logIncident } from './logging.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledgerFile: string): Layer.Layer<DispatcherServices> {
  const ledger = ledgerLayer({ fileName: ledgerFile });
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export const compositionRoot: ServerOptions<DispatcherServices> = {
  ...defaultServerOptions,
  runtimeLayer: ({ ledgerFile }) => applicationLayer(ledgerFile),
  routes: (runtime) => [
    operationRoutes({ catalog: makeCatalog(brainOperations), dispatcher: makeDispatcher([]), runCall: runtime.run }),
  ],
};
