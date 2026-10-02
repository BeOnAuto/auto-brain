import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { makeInference, makeModelAccess, type ModelAccess, type ModelSettings } from '@beonauto/inference';
import { ledgerLayer } from '@beonauto/ledger';
import { IncidentReporter, type DispatcherServices } from '@beonauto/operations';
import { makeSpecOperations } from '@beonauto/specs';
import { Effect, Layer } from 'effect';

import { defaultServerOptions, servedBy, type ServerOptions } from './lifecycle.ts';
import { logIncident, logModelProviders, logProviderMessage } from './logging.ts';
import { routesServing } from './served-routes.ts';

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledgerFile: string): Layer.Layer<DispatcherServices> {
  const ledger = ledgerLayer({ fileName: ledgerFile });
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function compositionRootWith(modelAccessOf: ModelAccessOf): ServerOptions<DispatcherServices> {
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledgerFile }) => applicationLayer(ledgerFile),
    serve: async (runtime, { models }) => {
      const { languageModel, status } = await Effect.runPromise(modelAccessOf(models));
      await runtime.run(logModelProviders(status));
      const inference = makeInference({ languageModel });
      return servedBy(routesServing([...brainOperations, ...makeSpecOperations([inference])])(runtime));
    },
  };
}

export const compositionRoot = compositionRootWith((settings) =>
  makeModelAccess(settings, { reportProviderMessage: logProviderMessage }),
);
