import { Config, Option } from 'effect';

export interface TemporalSettings {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly apiKey?: () => string;
  readonly tls: boolean;
}

export interface TemporalConnectionOptions {
  readonly address: string;
  readonly tls: boolean;
  readonly apiKey?: string;
}

export const TemporalSettingsConfig: Config.Config<Option.Option<TemporalSettings>> = Config.all({
  address: Config.String('TEMPORAL_ADDRESS').pipe(Config.withDefault('')),
  namespace: Config.NonEmptyString('TEMPORAL_NAMESPACE').pipe(Config.withDefault('default')),
  taskQueue: Config.NonEmptyString('TEMPORAL_TASK_QUEUE').pipe(Config.withDefault('auto-brain')),
  apiKey: Config.String('TEMPORAL_API_KEY').pipe(Config.withDefault('')),
  tls: Config.Boolean('TEMPORAL_TLS').pipe(Config.withDefault(false)),
}).pipe(
  Config.map(({ address, namespace, taskQueue, apiKey, tls }) => {
    if (address.trim() === '') {
      return Option.none();
    }
    const settings = { address, namespace, taskQueue, tls };
    return Option.some(apiKey === '' ? settings : { ...settings, apiKey: () => apiKey });
  }),
);

export function connectionOptionsOf({ address, apiKey, tls }: TemporalSettings): TemporalConnectionOptions {
  return apiKey === undefined ? { address, tls } : { address, tls: true, apiKey: apiKey() };
}
