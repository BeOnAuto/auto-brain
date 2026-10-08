import { ledgerBrainRegistry } from '@beonauto/brains';
import { IncidentReporter, type DispatcherServices, type Ledger } from '@beonauto/operations';
import type { HostClock } from '@beonauto/workflow-host';
import { Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { logIncident, logLedger } from '../logging/logging.ts';
import { serveWorkflows } from '../workflows/workflows.ts';
import { ledgerLayerOf } from './ledger-store.ts';
import { functionWiringOf, functionsServedBy, type FunctionWiring } from './served-functions.ts';
import { loggedModelAccess } from './served-inference.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerBrainRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function compositionRootWith(
  modelAccessOf: FunctionWiring['modelAccessOf'],
  programPoolOf?: FunctionWiring['programPoolOf'],
  clock?: HostClock,
): ServerOptions<DispatcherServices> {
  const wiring = functionWiringOf(modelAccessOf, programPoolOf);
  return {
    ...defaultServerOptions,
    runtimeLayer: ({ ledger }) => applicationLayer(ledgerLayerOf(ledger, wiring.recall.appends)),
    serve: async (runtime, settings) => {
      const { ledger, workflows } = settings;
      await runtime.run(logLedger(ledger));
      const functions = await functionsServedBy(runtime, settings, wiring);
      const parts = { ledger, workflows, ...functions.parts, ...(clock === undefined ? {} : { clock }) };
      return functions.closing(await serveWorkflows(runtime, parts));
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
