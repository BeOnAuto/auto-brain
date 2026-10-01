import type { AddressInfo } from 'node:net';

import { createApiHandler, makeRunner, type RegisterRoutes } from '@beonauto/api';
import type { Environment } from '@beonauto/config';
import { Layer } from 'effect';

import { createHttpServer, listen } from './http-server.ts';
import { isLocalMode } from './local-mode.ts';
import { announceAccess, jsonLogsToStderr, logIncident } from './logging.ts';
import { readSettings } from './settings.ts';
import { shutDown } from './shutdown.ts';

export interface RunningServer {
  readonly port: number;
  stop(): Promise<void>;
}

export interface ServerProcess {
  readonly env: Environment;
  readonly stdout: { write(message: string): unknown };
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export interface ServerOptions {
  readonly routes: readonly RegisterRoutes[];
  readonly shutdownDeadlineMs: number;
  readonly runtimeLayer: Layer.Layer<never>;
}

const defaultOptions: ServerOptions = { routes: [], shutdownDeadlineMs: 8000, runtimeLayer: Layer.empty };

export async function startServer(
  environment: Environment,
  options: Partial<ServerOptions> = {},
): Promise<RunningServer> {
  const { routes, shutdownDeadlineMs, runtimeLayer } = { ...defaultOptions, ...options };
  const settings = readSettings(environment);
  const localMode = isLocalMode(settings);
  const runner = await makeRunner(runtimeLayer.pipe(Layer.provideMerge(jsonLogsToStderr)));
  await runner.run(announceAccess({ localMode, apiKeysConfigured: settings.apiKeysConfigured }));
  const api = createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    localMode,
    routes,
    reportIncident: (incident, error) => {
      void runner.run(logIncident(incident, error));
    },
  });
  const server = createHttpServer(api.listener);
  try {
    await listen(server, settings.port, settings.host);
  } catch (error) {
    await runner.dispose();
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return {
    port: tcpPort(server.address()),
    stop: async () => {
      stopping ??= shutDown(server, { closeApi: api.close, disposeRuntime: runner.dispose }, shutdownDeadlineMs);
      await stopping;
    },
  };
}

export async function runServer(
  serverProcess: ServerProcess,
  options: Partial<ServerOptions> = {},
): Promise<RunningServer> {
  const server = await startServer(serverProcess.env, options);
  serverProcess.stdout.write(`auto-brain listening on port ${server.port}\n`);
  const stopOnSignal = (): void => {
    void server.stop();
  };
  serverProcess.once('SIGTERM', stopOnSignal);
  serverProcess.once('SIGINT', stopOnSignal);
  return server;
}

export function tcpPort(address: Readonly<AddressInfo> | string | null): number {
  if (address === null || typeof address === 'string') {
    throw new TypeError('The server is not listening on a TCP port');
  }
  return address.port;
}
