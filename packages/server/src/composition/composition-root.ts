import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { IncidentReporter, type DispatcherServices, type Ledger } from '@beonauto/operations';
import { Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { logIncident, logLedger } from '../logging/logging.ts';
import { serveWorkflows } from '../workflows/workflows.ts';
import { ledgerLayerOf } from './ledger-store.ts';
import { inferenceServedBy, loggedModelAccess, type ModelAccessOf } from './served-inference.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function compositionRootWith(modelAccessOf: ModelAccessOf): ServerOptions<DispatcherServices> {
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledger }) => applicationLayer(ledgerLayerOf(ledger)),
    serve: async (runtime, settings) => {
      const { ledger, workflows } = settings;
      await runtime.run(logLedger(ledger));
      const { primitive, listModels, withToolsClosed } = await inferenceServedBy(runtime, settings, modelAccessOf);
      const orgOperations = [...brainOperations, listModels];
      return withToolsClosed(
        await serveWorkflows(runtime, { ledger, workflows, primitives: [primitive], orgOperations }),
      );
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
