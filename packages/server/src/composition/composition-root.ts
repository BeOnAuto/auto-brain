import type { AppRuntime } from '@beonauto/api';
import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import { makeInference, makeModelAccess, type ModelAccess, type ModelSettings } from '@beonauto/inference';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { IncidentReporter, type DispatcherServices } from '@beonauto/operations';
import { makeSpecOperations, type Primitive } from '@beonauto/specs';
import { Effect, Layer } from 'effect';

import { defaultServerOptions, servedBy, type ServerOptions } from '../lifecycle/lifecycle.ts';
import {
  logIncident,
  logModelProviders,
  logOperatorHint,
  logProviderMessage,
  logsToStderr,
  logWorkflowsNotOffered,
} from '../logging/logging.ts';
import { routesServing } from './served-routes.ts';

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledgerFile: string): Layer.Layer<DispatcherServices> {
  const ledger = ledgerLayer({ fileName: ledgerFile });
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
    runtimeLayer: ({ ledgerFile }) => applicationLayer(ledgerFile),
    serve: async (runtime, { models, workflows, logFormat }) => {
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
