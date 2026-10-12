import { Config } from 'effect';

export interface CountBounds {
  readonly setting: string;
  readonly least: number;
  readonly most: number;
  readonly example: number;
}

export function countSourceOf({ setting, example }: CountBounds): Config.Config<string> {
  return Config.String(setting).pipe(Config.withDefault(String(example)));
}

export function countProblemOf(value: number, { setting, least, most, example }: CountBounds): readonly string[] {
  return value >= least && value <= most
    ? []
    : [`${setting}: Expected a whole number from ${least} to ${most}, such as ${example}`];
}
