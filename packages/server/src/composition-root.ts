import { mcpRoutes, operationRoutes, type AppRuntime, type RegisterRoutes } from '@beonauto/api';
import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { ledgerLayer } from '@beonauto/ledger';
import { IncidentReporter, makeCatalog, makeDispatcher, type DispatcherServices } from '@beonauto/operations';
import { Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from './lifecycle.ts';
import { logIncident, logMcpError } from './logging.ts';
import { release } from './release.ts';

type Operations = Parameters<typeof makeCatalog>[0];

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledgerFile: string): Layer.Layer<DispatcherServices> {
  const ledger = ledgerLayer({ fileName: ledgerFile });
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function routesServing(
  operations: Operations,
): (runtime: AppRuntime<DispatcherServices>) => readonly RegisterRoutes[] {
  return (runtime) => {
    const catalog = makeCatalog(operations);
    const dispatcher = makeDispatcher([]);
    return [
      operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
      mcpRoutes({
        catalog,
        dispatcher,
        runCall: runtime.run,
        serverInfo: release,
        reportError: (error) => {
          void runtime.run(logMcpError(error));
        },
      }),
    ];
  };
}

export const compositionRoot: ServerOptions<DispatcherServices> = {
  ...defaultServerOptions,
  runtimeLayer: ({ ledgerFile }) => applicationLayer(ledgerFile),
  routes: routesServing(brainOperations),
};
