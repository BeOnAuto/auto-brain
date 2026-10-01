import type { AddressInfo } from 'node:net';

import { createApiHandler, makeAppRuntime, type RegisterRoutes, type AppRuntime } from '@beonauto/api';
import type { Environment } from '@beonauto/config';
import { authenticatorFor } from '@beonauto/identity';
import { Effect, Layer } from 'effect';

import { createHttpServer, listen } from './http-server.ts';
import { logAccessMode, jsonLogsToStderr, logIncident } from './logging.ts';
import { readSettings, type Settings } from './settings.ts';
import { shutDown } from './shutdown.ts';
import { StartupError } from './startup-error.ts';

export interface RunningServer {
  readonly port: number;
  stop(): Promise<void>;
}

export interface ServerOptions<R> {
  readonly runtimeLayer: (settings: Settings) => Layer.Layer<R>;
  readonly routes: (
    runtime: AppRuntime<R>,
    settings: Settings,
  ) => readonly RegisterRoutes[] | Promise<readonly RegisterRoutes[]>;
  readonly shutdownTimeoutMs: number;
  readonly exitDeadlineMs: number;
}

export const defaultServerOptions: ServerOptions<never> = {
  runtimeLayer: () => Layer.empty,
  routes: () => [],
  shutdownTimeoutMs: 8000,
  exitDeadlineMs: 1000,
};

async function routesOf<R>(
  options: ServerOptions<R>,
  runtime: AppRuntime<R>,
  settings: Settings,
): Promise<readonly RegisterRoutes[]> {
  try {
    return await options.routes(runtime, settings);
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

async function startRuntime<R>(services: Layer.Layer<R>): Promise<AppRuntime<R>> {
  try {
    return await makeAppRuntime(services.pipe(Layer.provideMerge(jsonLogsToStderr)));
  } catch (failure) {
    throw new StartupError({ message: `The server's services could not start: ${String(failure)}` });
  }
}

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const settings = readSettings(environment);
  const authenticator = authenticatorFor(settings);
  const runtime = await startRuntime(options.runtimeLayer(settings));
  await runtime.run(logAccessMode(authenticator.mode, settings.localMode));
  const api = createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    authenticator,
    routes: await routesOf(options, runtime, settings),
    reportIncident: (id, error, requestId) => {
      void runtime.run(logIncident({ id, original: error }).pipe(Effect.annotateLogs({ requestId })));
    },
  });
  const server = createHttpServer(api.listener);
  try {
    await listen(server, settings.port, settings.host);
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return {
    port: tcpPort(server.address()),
    stop: async () => {
      stopping ??= shutDown(
        server,
        { closeApi: api.close, disposeRuntime: runtime.dispose },
        options.shutdownTimeoutMs,
      );
      await stopping;
    },
  };
}

export function tcpPort(address: Readonly<AddressInfo> | string | null): number {
  if (address === null || typeof address === 'string') {
    throw new TypeError('The server is not listening on a TCP port');
  }
  return address.port;
}
