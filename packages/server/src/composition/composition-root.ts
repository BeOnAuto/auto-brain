import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { IncidentReporter, type DispatcherServices, type Ledger } from '@beonauto/operations';
import { Layer } from 'effect';

import { defaultServerOptions, servedBy, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { logIncident, logLedger, logsToStderr, logWorkflowsNotOffered } from '../logging/logging.ts';
import { brainOperationsServing } from './brain-operations.ts';
import { ledgerLayerOf } from './ledger-store.ts';
import { inferenceServedBy, loggedModelAccess, type ModelAccessOf } from './served-inference.ts';
import { routesServing } from './served-routes.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function compositionRootWith(modelAccessOf: ModelAccessOf): ServerOptions<DispatcherServices> {
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledger }) => applicationLayer(ledgerLayerOf(ledger)),
    serve: async (runtime, settings) => {
      const { ledger, workflows, logFormat } = settings;
      await runtime.run(logLedger(ledger));
      const { primitive, listModels, withToolsClosed } = await inferenceServedBy(runtime, settings, modelAccessOf);
      const primitives = [primitive];
      const orgOperations = [...brainOperations, listModels];
      if (workflows === undefined) {
        await runtime.run(logWorkflowsNotOffered);
        return withToolsClosed(
          servedBy(routesServing([...orgOperations, ...brainOperationsServing(primitives)])(runtime)),
        );
      }
      const { serveWorkflows } = await import('../workflows/workflows.ts');
      const logs = logsToStderr(logFormat);
      return withToolsClosed(await serveWorkflows(runtime, { settings: workflows, primitives, orgOperations, logs }));
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
