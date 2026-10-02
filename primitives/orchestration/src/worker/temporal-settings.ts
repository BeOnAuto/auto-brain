import { Config, ConfigProvider, Data, Effect, Option } from 'effect';

import { readDuration } from '../dsl/durations.ts';

export interface TemporalSettings {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly apiKey?: () => string;
  readonly tls: boolean;
  readonly mostDuration: number;
  readonly workflowBundle?: string;
}

export interface TemporalConnectionOptions {
  readonly address: string;
  readonly tls: boolean;
  readonly apiKey?: string;
}

export interface SettingProblem {
  readonly setting: string;
  readonly detail: string;
}

export class TemporalSettingsInvalid extends Data.TaggedError('temporal_settings_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

type Environment = Readonly<Record<string, string | undefined>>;

const hour = 3_600_000;

const leastMostDuration = 2 * hour;

const greatestMostDuration = 365 * 24 * hour;

const hostAndPort = /^(?:\[[0-9a-f:.]+\]|[^\s/:[\]]+):\d{1,5}$/iu;

const tlsValues: ReadonlyMap<string, boolean> = new Map<string, boolean>([
  ['true', true],
  ['yes', true],
  ['on', true],
  ['1', true],
  ['y', true],
  ['false', false],
  ['no', false],
  ['off', false],
  ['0', false],
  ['n', false],
]);

const sources = Config.all({
  address: Config.String('TEMPORAL_ADDRESS').pipe(Config.withDefault('')),
  namespace: Config.String('TEMPORAL_NAMESPACE').pipe(Config.withDefault('default')),
  taskQueue: Config.String('TEMPORAL_TASK_QUEUE').pipe(Config.withDefault('auto-brain')),
  apiKey: Config.String('TEMPORAL_API_KEY').pipe(Config.withDefault('')),
  tls: Config.String('TEMPORAL_TLS').pipe(Config.withDefault('false')),
  mostDuration: Config.String('ORCHESTRATION_MAX_DURATION').pipe(Config.withDefault('P30D')),
  workflowBundle: Config.String('ORCHESTRATION_WORKFLOW_BUNDLE').pipe(Config.withDefault('')),
});

interface Sources {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly tls: string;
  readonly mostDuration: string;
}

export const readTemporalSettings = Effect.fnUntraced(function* (environment: Environment) {
  const source = yield* sources.parse(ConfigProvider.fromEnvRecord(environment)).pipe(Effect.orDie);
  const address = source.address.trim();
  if (address === '') {
    return Option.none<TemporalSettings>();
  }
  const problems = problemsOf({ ...source, address });
  if (problems.length > 0) {
    return yield* Effect.fail(invalid(problems));
  }
  const workflowBundle = source.workflowBundle.trim();
  const settings = {
    address,
    namespace: source.namespace.trim(),
    taskQueue: source.taskQueue.trim(),
    tls: tlsValues.get(source.tls.trim().toLowerCase()) === true,
    mostDuration: millisecondsOf(source.mostDuration),
    ...(workflowBundle === '' ? {} : { workflowBundle }),
  };
  return Option.some<TemporalSettings>(source.apiKey === '' ? settings : { ...settings, apiKey: () => source.apiKey });
});

export function connectionOptionsOf({ address, apiKey, tls }: TemporalSettings): TemporalConnectionOptions {
  return apiKey === undefined ? { address, tls } : { address, tls: true, apiKey: apiKey() };
}

function problemsOf(source: Sources): readonly SettingProblem[] {
  return [
    hostAndPort.test(source.address)
      ? []
      : [{ setting: 'TEMPORAL_ADDRESS', detail: 'Expected host:port, such as temporal:7233' }],
    source.namespace.trim() === ''
      ? [{ setting: 'TEMPORAL_NAMESPACE', detail: 'Expected the name of a namespace' }]
      : [],
    source.taskQueue.trim() === ''
      ? [{ setting: 'TEMPORAL_TASK_QUEUE', detail: 'Expected the name of a task queue' }]
      : [],
    tlsValues.has(source.tls.trim().toLowerCase())
      ? []
      : [{ setting: 'TEMPORAL_TLS', detail: 'Expected true or false' }],
    mostDurationFits(source.mostDuration)
      ? []
      : [
          {
            setting: 'ORCHESTRATION_MAX_DURATION',
            detail: 'Expected an ISO 8601 duration from PT2H to P365D, such as P30D',
          },
        ],
  ].flat();
}

function invalid(problems: readonly SettingProblem[]): TemporalSettingsInvalid {
  const listed = problems.map(({ setting, detail }) => `${setting}: ${detail}`).join('; ');
  return new TemporalSettingsInvalid({ message: `The Temporal settings are invalid. ${listed}`, problems });
}

function mostDurationFits(text: string): boolean {
  const milliseconds = millisecondsOf(text);
  return milliseconds >= leastMostDuration && milliseconds <= greatestMostDuration;
}

function millisecondsOf(text: string): number {
  return { milliseconds: 0, ...readDuration(text.trim()) }.milliseconds;
}
