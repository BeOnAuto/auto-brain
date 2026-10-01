import { authenticatorFor, createApiKey, type Authenticator } from '@beonauto/identity';
import { everyPermission, makeCatalog, makeDispatcher, type DispatcherServices } from '@beonauto/operations';
import {
  memoryBrainDirectory,
  memoryLedger,
  recordingReporter,
  type ReportedIncident,
} from '@beonauto/operations/testing';
import { Layer } from 'effect';

import { makeRunner, operationRoutes, type ApiHandler, type Runner } from '../index.ts';
import { handlerWith } from './api-calls.ts';
import { notebookOperations } from './notebook.ts';

export interface OperationServer {
  readonly handler: ApiHandler;
  readonly runner: Runner<DispatcherServices>;
  readonly incidents: () => readonly ReportedIncident[];
}

const knownBrains = [
  { org: 'acme', brain: 'alpha' },
  { org: 'acme', brain: 'beta' },
  { org: 'globex', brain: 'gamma' },
];

export const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: everyPermission, brains: '*' });

export const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'brain:read'],
  brains: '*',
});

export const acmeAlphaWriter = createApiKey({
  id: 'acme-alpha-writer',
  org: 'acme',
  permissions: everyPermission,
  brains: ['alpha'],
});

export const globexAdmin = createApiKey({
  id: 'globex-admin',
  org: 'globex',
  permissions: everyPermission,
  brains: '*',
});

const keyHolders = authenticatorFor({
  host: '0.0.0.0',
  apiKeys: [acmeAdmin.entry, acmeReader.entry, acmeAlphaWriter.entry, globexAdmin.entry],
});

export interface OperationServerOptions {
  readonly authenticator?: Authenticator;
  readonly operations?: Parameters<typeof makeCatalog>[0];
}

export async function operationServer({
  authenticator = keyHolders,
  operations = notebookOperations,
}: OperationServerOptions = {}): Promise<OperationServer> {
  const ledger = memoryLedger();
  const recording = recordingReporter();
  const runner = await makeRunner(Layer.mergeAll(ledger.layer, memoryBrainDirectory(knownBrains), recording.layer));
  const routes = operationRoutes({
    catalog: makeCatalog(operations),
    dispatcher: makeDispatcher([]),
    runCall: runner.run,
  });
  const { handler } = handlerWith({ authenticator, routes: [routes] });
  return { handler, runner, incidents: recording.reported };
}
