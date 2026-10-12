import { IncidentReporter, type DispatcherServices, type Ledger } from '@on.auto/operations';
import { ledgerPlaybookRegistry } from '@on.auto/playbooks';
import { Layer } from 'effect';

import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { logContentStore, logIncident, logLedger } from '../logging/logging.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { ledgerLayerFor } from './ledger-store.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess } from './served-reasoning.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(ledger: Layer.Layer<Ledger>): Layer.Layer<DispatcherServices> {
  return Layer.mergeAll(ledger, ledgerPlaybookRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function compositionRootWith(
  modelAccessOf: FunctionWiring['modelAccessOf'],
  programPoolOf?: FunctionWiring['programPoolOf'],
  clock?: WorkflowParts['clock'],
  toolTiming?: FunctionWiring['toolTiming'],
): ServerOptions<DispatcherServices> {
  const wiring = functionWiringOf(modelAccessOf, programPoolOf, toolTiming);
  return {
    ...defaultServerOptions,
    runtimeLayer: (settings) => applicationLayer(ledgerLayerFor(settings, wiring.projections.appends)),
    serve: async (runtime, settings) => {
      const { ledger, workflows } = settings;
      await runtime.run(logLedger(ledger));
      await runtime.run(logContentStore(settings.content));
      const functions = await functionsServedBy(runtime, settings, wiring);
      const parts = { ledger, workflows, ...functions.parts, ...(clock === undefined ? {} : { clock }) };
      return functions.closing(await serveWorkflows(runtime, parts));
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
