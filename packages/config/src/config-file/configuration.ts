import { Result } from 'effect';

import type { Environment } from '../server-config.ts';
import { readConfigFile, type ConfigFile, type ConfigFileInvalid } from './config-file.ts';
import type { FileSetting } from './file-setting.ts';

export interface FileUse {
  readonly path: string;
  readonly fromFile: readonly string[];
  readonly overridden: readonly string[];
  readonly place: (setting: string, pointer: string) => string;
}

export interface Configuration {
  readonly environment: Environment;
  readonly file: FileUse | undefined;
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function layered(environment: Environment, { path, settings, place }: ConfigFile): Configuration {
  const named = [...settings.keys()];
  const overridden = named.filter((setting) => isSet(environment[setting]));
  const fromFile = named.filter((setting) => !overridden.includes(setting));
  return {
    environment: { ...environment, ...Object.fromEntries(fromFile.map((setting) => [setting, settings.get(setting)])) },
    file: { path, fromFile, overridden, place },
  };
}

export function configurationOf(
  environment: Environment,
  settings: readonly FileSetting[],
): Result.Result<Configuration, ConfigFileInvalid> {
  const path = environment['CONFIG_FILE'];
  return isSet(path)
    ? Result.map(readConfigFile(path, settings, environment), (file) => layered(environment, file))
    : Result.succeed({ environment, file: undefined });
}
