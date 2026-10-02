import { DefaultLogger, Runtime } from '@temporalio/worker';

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

const describedFields = [
  'sdkComponent',
  'namespace',
  'taskQueue',
  'workflowType',
  'workflowId',
  'runId',
  'activityType',
  'activityId',
  'attempt',
];

export function installTemporalRuntime(log: TemporalLog): void {
  if (Reflect.get(Runtime, '_instance') !== undefined) {
    return;
  }
  Runtime.install({
    logger: new DefaultLogger('WARN', ({ level, message, meta }: LoggedByTemporal) => {
      log({ level, message, context: contextOf(meta ?? {}) });
    }),
    shutdownSignals: [],
    telemetryOptions: { logging: { filter: { core: 'WARN', other: 'ERROR' }, forward: {} } },
  });
}

function contextOf(meta: object): TemporalLogContext {
  const context: Record<string, Described> = {};
  for (const field of describedFields) {
    const value: unknown = Reflect.get(meta, field);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      context[field] = value;
    }
  }
  const error: unknown = Reflect.get(meta, 'error');
  return error instanceof Error ? { ...context, error: error.message } : context;
}
