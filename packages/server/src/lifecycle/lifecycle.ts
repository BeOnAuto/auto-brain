import type { AddressInfo } from 'node:net';

import { createApiHandler, makeAppRuntime, type RegisterRoutes, type AppRuntime } from '@beonauto/api';
import type { Environment } from '@beonauto/config';
import { authenticatorFor } from '@beonauto/identity';
import { Effect, Layer } from 'effect';

import { logAccessMode, logConfigFile, logIncident, logsToStderr, type LogFormat } from '../logging/logging.ts';
import { readSettings, type Settings } from '../settings/settings.ts';
import { createHttpServer, listen } from './http-server.ts';
import { shutDown } from './shutdown.ts';
import { StartupError } from './startup-error.ts';

export interface RunningServer {
  readonly port: number;
  stop(): Promise<void>;
}

export interface Served {
  readonly routes: readonly RegisterRoutes[];
  readonly stopWork: () => Promise<void>;
}

export interface ServerOptions<R> {
  readonly runtimeLayer: (settings: Settings) => Layer.Layer<R>;
  readonly serve: (runtime: AppRuntime<R>, settings: Settings) => Served | Promise<Served>;
  readonly shutdownTimeoutMs: number;
  readonly exitDeadlineMs: number;
}

export function servedBy(routes: readonly RegisterRoutes[]): Served {
  return { routes, stopWork: () => Promise.resolve() };
}

export const defaultServerOptions: ServerOptions<never> = {
  runtimeLayer: () => Layer.empty,
  serve: () => servedBy([]),
  shutdownTimeoutMs: 8000,
  exitDeadlineMs: 1000,
};

async function servedOf<R>(options: ServerOptions<R>, runtime: AppRuntime<R>, settings: Settings): Promise<Served> {
  try {
    return await options.serve(runtime, settings);
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

async function startRuntime<R>(services: Layer.Layer<R>, logFormat: LogFormat): Promise<AppRuntime<R>> {
  try {
    return await makeAppRuntime(services.pipe(Layer.provideMerge(logsToStderr(logFormat))));
  } catch (failure) {
    throw new StartupError({ message: `The server's services could not start: ${String(failure)}` });
  }
}

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const settings = readSettings(environment);
  const authenticator = authenticatorFor(settings);
  const runtime = await startRuntime(options.runtimeLayer(settings), settings.logFormat);
  await runtime.run(logAccessMode(authenticator.mode, settings.localMode));
  await runtime.run(logConfigFile(settings.configFile));
  const served = await servedOf(options, runtime, settings);
  const api = createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    authenticator,
    routes: served.routes,
    reportIncident: (id, error, requestId) => {
      void runtime.run(logIncident({ id, original: error }).pipe(Effect.annotateLogs({ requestId })));
    },
  });
  const server = createHttpServer(api.listener);
  try {
    await listen(server, settings.port, settings.host);
  } catch (error) {
    await served.stopWork();
    await runtime.dispose();
    await api.close();
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return {
    port: tcpPort(server.address()),
    stop: async () => {
      stopping ??= shutDown(
        server,
        { stopWork: served.stopWork, disposeRuntime: runtime.dispose, closeApi: api.close },
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
