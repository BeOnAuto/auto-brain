import type { AddressInfo } from 'node:net';

import { createApiHandler, makeAppRuntime, type RegisterRoutes, type AppRuntime } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import { authenticatorFor, issuersOf } from '@on.auto/identity';
import { Effect, Layer } from 'effect';

import { logAccessMode, logConfigFile, logIncident, serverLogs, type LogSettings } from '../logging/logging.ts';
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

export type ServedClosing = (served: Served) => Served;

export interface Composed<R> {
  readonly services: Layer.Layer<R>;
  readonly serve: (runtime: AppRuntime<R>) => Served | Promise<Served>;
}

export interface ServerOptions<R> {
  readonly composed: (settings: Settings) => Composed<R>;
  readonly shutdownTimeoutMs: number;
  readonly exitDeadlineMs: number;
}

export function servedBy(routes: readonly RegisterRoutes[]): Served {
  return { routes, stopWork: () => Promise.resolve() };
}

export const defaultServerOptions: ServerOptions<never> = {
  composed: () => ({ services: Layer.empty, serve: () => servedBy([]) }),
  shutdownTimeoutMs: 8000,
  exitDeadlineMs: 1000,
};

async function servedOf<R>(composed: Composed<R>, runtime: AppRuntime<R>): Promise<Served> {
  try {
    return await composed.serve(runtime);
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

async function startRuntime<R>(services: Layer.Layer<R>, logs: LogSettings): Promise<AppRuntime<R>> {
  try {
    return await makeAppRuntime(services.pipe(Layer.provideMerge(serverLogs(logs))));
  } catch (failure) {
    throw new StartupError({ message: `The server's services could not start: ${String(failure)}` });
  }
}

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const settings = readSettings(environment);
  const issuers = settings.signIn === undefined ? undefined : await issuersOf(settings.signIn);
  const authenticator = authenticatorFor({ ...settings, issuers });
  const composed = options.composed(settings);
  const runtime = await startRuntime(composed.services, settings);
  await runtime.run(logAccessMode({ ...settings, mode: authenticator.mode }));
  await runtime.run(logConfigFile(settings.configFile));
  const served = await servedOf(composed, runtime);
  const api = createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    authenticator,
    routes: served.routes,
    reportIncident: (id, error, requestId, call) => {
      void runtime.run(logIncident({ id, original: error, call }).pipe(Effect.annotateLogs({ requestId })));
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
