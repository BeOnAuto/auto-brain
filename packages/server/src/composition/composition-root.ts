import type { AppRuntime } from '@beonauto/api';
import { brainOperations, ledgerBrainRegistry } from '@beonauto/brains';
import {
  defineListModels,
  makeReasoningFunctionAdapter,
  makeModelAccess,
  type ModelAccess,
  type ModelSettings,
} from '@beonauto/inference';
import { IncidentReporter, type DispatcherServices, type Ledger } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { logIncident, logLedger, logModelProviders, logOperatorHint, logProviderMessage } from '../logging/logging.ts';
import { serveWorkflows } from '../workflows/workflows.ts';
import { ledgerLayerOf } from './ledger-store.ts';

export type ModelAccessOf = (settings: ModelSettings) => Effect.Effect<ModelAccess>;

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

interface ServedReasoning {
  readonly primitive: ReturnType<typeof makeReasoningFunctionAdapter>;
  readonly listModels: ReturnType<typeof defineListModels>;
}

async function reasoningServedBy(
  runtime: AppRuntime<DispatcherServices>,
  models: ModelSettings,
  modelAccessOf: ModelAccessOf,
): Promise<ServedReasoning> {
  const { languageModel, status, offered, catalog } = await Effect.runPromise(modelAccessOf(models));
  await runtime.run(logModelProviders(status));
  return { primitive: makeReasoningFunctionAdapter({ languageModel, offered }), listModels: defineListModels(catalog) };
}

export function compositionRootWith(modelAccessOf: ModelAccessOf): ServerOptions<DispatcherServices> {
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledger }) => applicationLayer(ledgerLayerOf(ledger)),
    serve: async (runtime, { ledger, models, workflows }) => {
      await runtime.run(logLedger(ledger));
      const { primitive, listModels } = await reasoningServedBy(runtime, models, modelAccessOf);
      return serveWorkflows(runtime, {
        ledger,
        workflows,
        primitives: [primitive],
        orgOperations: [...brainOperations, listModels],
      });
    },
  };
}

export const compositionRoot = compositionRootWith((settings) =>
  makeModelAccess(settings, { reportProviderMessage: logProviderMessage, reportOperatorHint: logOperatorHint }),
);
