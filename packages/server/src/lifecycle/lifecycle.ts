import { createApiHandler, makeAppRuntime, type RegisterRoutes, type AppRuntime } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import {
  authenticatorFor,
  identityServiceOf,
  type AccessMode,
  type Authenticator,
  type SignInSettings,
} from '@on.auto/identity';
import { Effect, Layer } from 'effect';

import {
  logAccessMode,
  logConfigFile,
  logIncident,
  logTelemetry,
  serverLogs,
  type LogSettings,
} from '../logging/logging.ts';
import { readSettings, type Settings } from '../settings/settings.ts';
import { startTelemetry, type Telemetry } from '../telemetry/start-telemetry.ts';
import { createHttpServer, listen, ownOriginOf, tcpPort } from './http-server.ts';
import { shutDown } from './shutdown.ts';
import { StartupError } from './startup-error.ts';

export interface RunningServer {
  readonly port: number;
  readonly mode: AccessMode;
  readonly signIn: SignInSettings | undefined;
  stop(): Promise<void>;
}

export interface Served {
  readonly routes: readonly RegisterRoutes[];
  readonly stopWork: () => Promise<void>;
}

export type ServedClosing = (served: Served) => Served;

export interface Composed<R> {
  readonly services: Layer.Layer<R>;
  readonly serve: (runtime: AppRuntime<R>, ownOrigin: () => string) => Served | Promise<Served>;
}

export interface ServerOptions<R> {
  readonly composed: (settings: Settings, telemetry: Telemetry) => Composed<R>;
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

interface Starting<R> {
  readonly settings: Settings;
  readonly authenticator: Authenticator;
  readonly telemetry: Telemetry;
  readonly options: ServerOptions<R>;
}

async function servedOf<R>(composed: Composed<R>, runtime: AppRuntime<R>, ownOrigin: () => string): Promise<Served> {
  try {
    return await composed.serve(runtime, ownOrigin);
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

async function startRuntime<R>(
  services: Layer.Layer<R>,
  logs: LogSettings,
  telemetry: Layer.Layer<never>,
): Promise<AppRuntime<R>> {
  try {
    return await makeAppRuntime(services.pipe(Layer.provideMerge(telemetry), Layer.provideMerge(serverLogs(logs))));
  } catch (failure) {
    throw new StartupError({ message: `The server's services could not start: ${String(failure)}` });
  }
}

async function started<R>({ settings, authenticator, telemetry, options }: Starting<R>): Promise<RunningServer> {
  const composed = options.composed(settings, telemetry);
  const runtime = await startRuntime(composed.services, settings, telemetry.layer);
  await runtime.run(logAccessMode({ ...settings, mode: authenticator.mode }));
  await runtime.run(logConfigFile(settings.configFile));
  await runtime.run(logTelemetry(settings.telemetry));
  const listening = { port: settings.port };
  const served = await servedOf(composed, runtime, () => ownOriginOf(settings.host, listening.port));
  const api = createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    authenticator,
    routes: served.routes,
    reportIncident: (id, error, requestId, call) => {
      void runtime.run(logIncident({ id, original: error, call }).pipe(Effect.annotateLogs({ requestId })));
    },
    ...(telemetry.requests === undefined ? {} : { requests: telemetry.requests }),
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
  listening.port = tcpPort(server.address());
  let stopping: Promise<void> | undefined;
  return {
    port: listening.port,
    mode: authenticator.mode,
    signIn: settings.signIn,
    stop: async () => {
      stopping ??= shutDown(
        server,
        {
          stopWork: served.stopWork,
          disposeRuntime: runtime.dispose,
          stopTelemetry: telemetry.shutdown,
          closeApi: api.close,
        },
        options.shutdownTimeoutMs,
      );
      await stopping;
    },
  };
}

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const settings = readSettings(environment);
  const identityService =
    settings.signIn === undefined
      ? undefined
      : await identityServiceOf({ ...settings.signIn, allowedOrigins: settings.allowedOrigins });
  const authenticator = authenticatorFor({ ...settings, identityService });
  const telemetry = startTelemetry(settings.telemetry);
  try {
    return await started({ settings, authenticator, telemetry, options });
  } catch (failure) {
    await telemetry.shutdown();
    throw failure;
  }
}
