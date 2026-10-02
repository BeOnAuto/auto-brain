import { DefaultLogger, Runtime, type RuntimeOptions } from '@temporalio/worker';

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

export const mostForwardedCharacters = 500;

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

let installed = false;

export function installTemporalRuntime(log: TemporalLog): void {
  install(() => ({
    logger: new DefaultLogger('WARN', (logged: LoggedByTemporal) => {
      if (logged.message !== tenantsWorkflowFailure) {
        log(forwarded(logged));
      }
    }),
    shutdownSignals: [],
    telemetryOptions: { logging: { filter: { core: 'WARN', other: 'ERROR' }, forward: {} } },
  }));
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
  return { level, message: capped(message.split(': ', 1).join('')), context: contextOf(meta) };
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
