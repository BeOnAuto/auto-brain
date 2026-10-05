import type { AppRuntime } from '@beonauto/api';
import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { makeInference, makeModelAccess, type ModelAccess, type ModelSettings } from '@beonauto/inference';
import { IncidentReporter, type DispatcherServices, type Ledger } from '@beonauto/operations';
import { makeSpecOperations, type Primitive } from '@beonauto/specs';
import { Effect, Layer } from 'effect';

import { defaultServerOptions, servedBy, type ServerOptions } from '../lifecycle/lifecycle.ts';
import {
  logIncident,
  logLedger,
  logModelProviders,
  logOperatorHint,
  logProviderMessage,
  logsToStderr,
  logWorkflowsNotOffered,
} from '../logging/logging.ts';
import { ledgerLayerOf } from './ledger-store.ts';
import { routesServing } from './served-routes.ts';

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

async function inferenceServedBy(
  runtime: AppRuntime<DispatcherServices>,
  models: ModelSettings,
  modelAccessOf: ModelAccessOf,
): Promise<Primitive> {
  const { languageModel, status, offered } = await Effect.runPromise(modelAccessOf(models));
  await runtime.run(logModelProviders(status));
  return makeInference({ languageModel, offered });
}

export function compositionRootWith(modelAccessOf: ModelAccessOf): ServerOptions<DispatcherServices> {
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledger }) => applicationLayer(ledgerLayerOf(ledger)),
    serve: async (runtime, { ledger, models, workflows, logFormat }) => {
      await runtime.run(logLedger(ledger));
      const primitives = [await inferenceServedBy(runtime, models, modelAccessOf)];
      if (workflows === undefined) {
        await runtime.run(logWorkflowsNotOffered);
        return servedBy(routesServing([...brainOperations, ...makeSpecOperations(primitives)])(runtime));
      }
      const { serveWorkflows } = await import('../workflows/workflows.ts');
      return serveWorkflows(runtime, { settings: workflows, primitives, logs: logsToStderr(logFormat) });
    },
  };
}

export const compositionRoot = compositionRootWith((settings) =>
  makeModelAccess(settings, { reportProviderMessage: logProviderMessage, reportOperatorHint: logOperatorHint }),
);
