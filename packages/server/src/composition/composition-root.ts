import type { DispatcherServices } from '@on.auto/operations';

import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { logContentStore, logLedger } from '../logging/logging.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { applicationLayer } from './application-layer.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { ledgerLayerFor } from './ledger-store.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess } from './served-reasoning.ts';

export function compositionRootWith(
  modelAccessOf: FunctionWiring['modelAccessOf'],
  programPoolOf?: FunctionWiring['programPoolOf'],
  clock?: WorkflowParts['clock'],
  toolTiming?: FunctionWiring['toolTiming'],
): ServerOptions<DispatcherServices> {
  const wiring = functionWiringOf(modelAccessOf, programPoolOf, toolTiming);
  return {
    ...defaultServerOptions,
    composed: (settings) => {
      const database = ledgerDatabaseOf(settings);
      return {
        services: applicationLayer(ledgerLayerFor(settings, database, wiring.projections.appends)),
        serve: async (runtime) => {
          const { ledger, workflows } = settings;
          await runtime.run(logLedger(ledger));
          await runtime.run(logContentStore(settings.content));
          const functions = await functionsServedBy(runtime, settings, database, wiring);
          const parts = { ledger, workflows, ...functions.parts, ...(clock === undefined ? {} : { clock }) };
          return functions.closing(await serveWorkflows(runtime, parts));
        },
      };
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
