import { mcpRoutes, operationRoutes, type AppRuntime, type RegisterRoutes } from '@beonauto/api';
import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { makeInference, makeModelAccess, type ModelAccess, type ModelSettings } from '@beonauto/inference';
import { ledgerLayer } from '@beonauto/ledger';
import { IncidentReporter, makeCatalog, makeDispatcher, type DispatcherServices } from '@beonauto/operations';
import { makeSpecOperations } from '@beonauto/specs';
import { Effect, Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from './lifecycle.ts';
import { logIncident, logMcpError, logModelProviders, logProviderMessage } from './logging.ts';
import { release } from './release.ts';

type Operations = Parameters<typeof makeCatalog>[0];

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

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

export function compositionRootWith(modelAccessOf: ModelAccessOf): ServerOptions<DispatcherServices> {
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledgerFile }) => applicationLayer(ledgerFile),
    routes: async (runtime, { models }) => {
      const { languageModel, status } = await Effect.runPromise(modelAccessOf(models));
      await runtime.run(logModelProviders(status));
      const inference = makeInference({ languageModel });
      return routesServing([...brainOperations, ...makeSpecOperations([inference])])(runtime);
    },
  };
}

export const compositionRoot = compositionRootWith((settings) =>
  makeModelAccess(settings, { reportProviderMessage: logProviderMessage }),
);
