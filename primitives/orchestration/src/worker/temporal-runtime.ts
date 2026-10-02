import { DefaultLogger, Runtime, type RuntimeOptions } from '@temporalio/worker';

import { isLostTemporal, makeOutageWatch } from './temporal-outage.ts';

type Described = string | number | boolean;

export type TemporalLogContext = Readonly<Record<string, Described>>;

export interface TemporalLogEntry {
  readonly level: string;
  readonly message: string;
  readonly context: TemporalLogContext;
}

export type TemporalLog = (entry: TemporalLogEntry) => void;

interface LoggedByTemporal {
  readonly level: string;
  readonly message: string;
  readonly meta?: object;
}

interface TemporalProbe {
  readonly reach: () => Promise<unknown>;
  readonly everyMs: number;
}

export const mostForwardedCharacters = 500;

export const probeEveryMs = 5000;

const describedFields = [
  'sdkComponent',
  'namespace',
  'taskQueue',
  'workflowType',
  'workflowId',
  'runId',
  'workflowRunId',
  'activityType',
  'attempt',
  'failureType',
];

const tenantsWorkflowFailure = 'Workflow failed';

const outage = makeOutageWatch();

let installed = false;

let watched: TemporalProbe | undefined;

let probing: NodeJS.Timeout | undefined;

export function installTemporalRuntime(log: TemporalLog): void {
  install(() => ({
    logger: new DefaultLogger('WARN', (logged: LoggedByTemporal) => {
      if (logged.message !== tenantsWorkflowFailure) {
        handled(log, forwarded(logged));
      }
    }),
    shutdownSignals: [],
    telemetryOptions: { logging: { filter: { core: 'WARN', other: 'ERROR' }, forward: {} } },
  }));
}

export function watchTemporal(reach: () => Promise<unknown>, everyMs = probeEveryMs): () => void {
  const probe = { reach, everyMs };
  watched = probe;
  return () => {
    if (watched === probe) {
      watched = undefined;
      stopProbing();
    }
  };
}

function handled(log: TemporalLog, entry: TemporalLogEntry): void {
  if (!isLostTemporal(entry)) {
    log(entry);
    return;
  }
  const line = outage.troubled(Date.now(), entry.context);
  if (line !== undefined) {
    log(line);
  }
  probeUntilReached(log);
}

function probeUntilReached(log: TemporalLog): void {
  const probe = watched;
  if (probing !== undefined || probe === undefined) {
    return;
  }
  probing = setInterval(() => {
    void reached(probe).then((reachedNow) => {
      const line = reachedNow ? outage.recovered(Date.now()) : undefined;
      if (line !== undefined) {
        stopProbing();
        log(line);
      }
      return line;
    });
  }, probe.everyMs);
  probing.unref();
}

async function reached({ reach }: TemporalProbe): Promise<boolean> {
  try {
    await reach();
    return true;
  } catch {
    return false;
  }
}

function stopProbing(): void {
  clearInterval(probing);
  probing = undefined;
}

export function runtimeShutdownSignals(): readonly string[] {
  install(() => ({ ...Runtime.defaultOptions, shutdownSignals: [] }));
  return Runtime.instance().options.shutdownSignals;
}

function install(options: () => RuntimeOptions): void {
  if (!installed) {
    installed = true;
    Runtime.install(options());
  }
}

function forwarded({ level, message, meta = {} }: LoggedByTemporal): TemporalLogEntry {
  return { level, message: capped(`Temporal reported: ${message.split(': ', 1).join('')}`), context: contextOf(meta) };
}

function capped(text: string): string {
  return text.slice(0, mostForwardedCharacters);
}

function contextOf(meta: object): TemporalLogContext {
  const context: Record<string, Described> = {};
  for (const field of describedFields) {
    const value: unknown = Reflect.get(meta, field);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      context[field] = typeof value === 'string' ? capped(value) : value;
    }
  }
  return { ...context, ...errorOf(Reflect.get(meta, 'error')), ...failureOf(Reflect.get(meta, 'failure')) };
}

function errorOf(error: unknown): TemporalLogContext {
  if (error instanceof Error) {
    const type: unknown = Reflect.get(error, 'type');
    return { errorType: capped(typeof type === 'string' && type !== '' ? type : error.name) };
  }
  const code = typeof error === 'string' ? /\bcode: (\w+)/u.exec(error)?.[1] : undefined;
  return code === undefined ? {} : { errorCode: capped(code) };
}

function failureOf(failure: unknown): TemporalLogContext {
  const code = typeof failure === 'string' ? /\[(TMPRL\d+)\]/u.exec(failure)?.[1] : undefined;
  return code === undefined ? {} : { failureCode: code };
}
