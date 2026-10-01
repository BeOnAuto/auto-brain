import type { AddressInfo } from 'node:net';

import { createApiHandler, makeRunner, type RegisterRoutes, type Runner } from '@beonauto/api';
import type { Environment } from '@beonauto/config';
import { authenticatorFor } from '@beonauto/identity';
import { Layer } from 'effect';

import { createHttpServer, listen } from './http-server.ts';
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

export interface ServerOptions<R> {
  readonly runtimeLayer: Layer.Layer<R>;
  readonly routes: (runner: Runner<R>) => readonly RegisterRoutes[];
  readonly shutdownDeadlineMs: number;
}

export const withoutOperations: ServerOptions<never> = {
  runtimeLayer: Layer.empty,
  routes: () => [],
  shutdownDeadlineMs: 8000,
};

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const settings = readSettings(environment);
  const authenticator = authenticatorFor(settings);
  const runner = await makeRunner(options.runtimeLayer.pipe(Layer.provideMerge(jsonLogsToStderr)));
  await runner.run(announceAccess(authenticator.mode));
  const api = createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    authenticator,
    routes: options.routes(runner),
    reportIncident: (id, error) => {
      void runner.run(logIncident({ id, original: error }));
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
      stopping ??= shutDown(
        server,
        { closeApi: api.close, disposeRuntime: runner.dispose },
        options.shutdownDeadlineMs,
      );
      await stopping;
    },
  };
}

export async function runServer<R>(serverProcess: ServerProcess, options: ServerOptions<R>): Promise<RunningServer> {
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
