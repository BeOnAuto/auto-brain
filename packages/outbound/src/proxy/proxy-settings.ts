export interface ProxySettings {
  readonly enabled: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

type Environment = Readonly<Record<string, string | undefined>>;

const proxyVariables: readonly string[] = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
];

function variablesSetIn(environment: Environment): readonly (readonly [string, string])[] {
  return proxyVariables.flatMap((name): readonly (readonly [string, string])[] => {
    const value = environment[name] ?? '';
    return value === '' ? [] : [[name, value]];
  });
}

export function proxySettingsOf(environment: Environment): ProxySettings {
  return {
    enabled: environment['NODE_USE_ENV_PROXY'] === '1',
    environment: Object.fromEntries(variablesSetIn(environment)),
  };
}
