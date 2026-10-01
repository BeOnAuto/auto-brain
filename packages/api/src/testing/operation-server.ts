import { authenticatorFor, createApiKey, type Authenticator } from '@beonauto/identity';
import { allPermissions, makeCatalog, makeDispatcher, type DispatcherServices } from '@beonauto/operations';
import {
  memoryBrainRegistry,
  memoryLedger,
  recordingReporter,
  type ReportedIncident,
} from '@beonauto/operations/testing';
import { Layer } from 'effect';

import { makeAppRuntime, mcpRoutes, operationRoutes, type ApiHandler, type AppRuntime } from '../index.ts';
import { createTestHandler } from './api-calls.ts';
import { notebookOperations } from './notebook.ts';

export interface OperationServer {
  readonly handler: ApiHandler;
  readonly runtime: AppRuntime<DispatcherServices>;
  readonly incidents: () => readonly ReportedIncident[];
  readonly mcpErrors: () => readonly string[];
}

export const testServerInfo = { name: 'auto-brain', version: '0.0.0-test' };

const knownBrains = [
  { org: 'acme', brain: 'alpha' },
  { org: 'acme', brain: 'beta' },
  { org: 'globex', brain: 'gamma' },
];

export const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

export const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'brain:read'],
  brains: '*',
});

export const acmeAlphaWriter = createApiKey({
  id: 'acme-alpha-writer',
  org: 'acme',
  permissions: allPermissions,
  brains: ['alpha'],
});

export const globexAdmin = createApiKey({
  id: 'globex-admin',
  org: 'globex',
  permissions: allPermissions,
  brains: '*',
});

const keyHolders = authenticatorFor({
  host: '0.0.0.0',
  apiKeys: [acmeAdmin.entry, acmeReader.entry, acmeAlphaWriter.entry, globexAdmin.entry],
  localMode: false,
});

export interface OperationServerOptions {
  readonly authenticator?: Authenticator;
  readonly allowedOrigins?: readonly string[];
  readonly operations?: Parameters<typeof makeCatalog>[0];
}

export async function operationServer({
  authenticator = keyHolders,
  allowedOrigins = [],
  operations = notebookOperations,
}: OperationServerOptions = {}): Promise<OperationServer> {
  const ledger = memoryLedger();
  const recording = recordingReporter();
  const runtime = await makeAppRuntime(Layer.mergeAll(ledger.layer, memoryBrainRegistry(knownBrains), recording.layer));
  const catalog = makeCatalog(operations);
  const dispatcher = makeDispatcher([]);
  const mcpErrors: string[] = [];
  const routes = [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    mcpRoutes({
      catalog,
      dispatcher,
      runCall: runtime.run,
      serverInfo: testServerInfo,
      reportError: (error) => {
        mcpErrors.push(error.message);
      },
    }),
  ];
  const { handler } = createTestHandler({ authenticator, allowedOrigins, routes });
  return { handler, runtime, incidents: recording.reported, mcpErrors: () => [...mcpErrors] };
}
