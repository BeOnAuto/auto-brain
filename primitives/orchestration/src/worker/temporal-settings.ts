import { Config, Option, Schema } from 'effect';

import { readDuration } from '../dsl/durations.ts';
import { defaultMostDuration } from '../interpreter/workflow-run.ts';

export interface TemporalSettings {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly apiKey?: () => string;
  readonly tls: boolean;
  readonly mostDuration: number;
}

export interface TemporalConnectionOptions {
  readonly address: string;
  readonly tls: boolean;
  readonly apiKey?: string;
}

const hour = 3_600_000;

const leastMostDuration = 2 * hour;

const greatestMostDuration = 365 * 24 * hour;

const MostDuration = Schema.String.check(Schema.makeFilter((text: string) => mostDurationProblem(text) ?? true));

export const TemporalSettingsConfig: Config.Config<Option.Option<TemporalSettings>> = Config.all({
  address: Config.String('TEMPORAL_ADDRESS').pipe(Config.withDefault('')),
  namespace: Config.NonEmptyString('TEMPORAL_NAMESPACE').pipe(Config.withDefault('default')),
  taskQueue: Config.NonEmptyString('TEMPORAL_TASK_QUEUE').pipe(Config.withDefault('auto-brain')),
  apiKey: Config.String('TEMPORAL_API_KEY').pipe(Config.withDefault('')),
  tls: Config.Boolean('TEMPORAL_TLS').pipe(Config.withDefault(false)),
  mostDuration: Config.schema(MostDuration, 'ORCHESTRATION_MAX_DURATION').pipe(Config.withDefault('P30D')),
}).pipe(
  Config.map(({ address, namespace, taskQueue, apiKey, tls, mostDuration }) => {
    if (address.trim() === '') {
      return Option.none();
    }
    const settings = { address, namespace, taskQueue, tls, mostDuration: millisecondsOf(mostDuration) };
    return Option.some(apiKey === '' ? settings : { ...settings, apiKey: () => apiKey });
  }),
);

export function connectionOptionsOf({ address, apiKey, tls }: TemporalSettings): TemporalConnectionOptions {
  return apiKey === undefined ? { address, tls } : { address, tls: true, apiKey: apiKey() };
}

function mostDurationProblem(text: string): string | undefined {
  const reading = readDuration(text);
  if ('problem' in reading) {
    return `ORCHESTRATION_MAX_DURATION is an ISO 8601 duration: ${reading.problem}`;
  }
  return reading.milliseconds < leastMostDuration || reading.milliseconds > greatestMostDuration
    ? `ORCHESTRATION_MAX_DURATION is at least PT2H and at most P365D, not ${text}`
    : undefined;
}

function millisecondsOf(text: string): number {
  return { milliseconds: defaultMostDuration, ...readDuration(text) }.milliseconds;
}
