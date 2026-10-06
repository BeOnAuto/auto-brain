import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { IncidentReporter, type DispatcherServices, type Ledger } from '@beonauto/operations';
import { Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { logIncident, logLedger } from '../logging/logging.ts';
import { serveWorkflows } from '../workflows/workflows.ts';
import { ledgerLayerOf } from './ledger-store.ts';
import { computationServedBy, workerPool, type ProgramPoolOf } from './served-computation.ts';
import { reasoningServedBy, loggedModelAccess, type ModelAccessOf } from './served-inference.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function compositionRootWith(
  modelAccessOf: ModelAccessOf,
  programPoolOf: ProgramPoolOf = workerPool,
): ServerOptions<DispatcherServices> {
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledger }) => applicationLayer(ledgerLayerOf(ledger)),
    serve: async (runtime, settings) => {
      const { ledger, workflows } = settings;
      await runtime.run(logLedger(ledger));
      const reasoning = await reasoningServedBy(runtime, settings, modelAccessOf);
      const computation = computationServedBy(settings.computation, programPoolOf);
      const orgOperations = [...brainOperations, reasoning.listModels];
      const primitives = [reasoning.primitive, computation.primitive];
      return computation.withPoolClosed(
        reasoning.withToolsClosed(await serveWorkflows(runtime, { ledger, workflows, primitives, orgOperations })),
      );
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
