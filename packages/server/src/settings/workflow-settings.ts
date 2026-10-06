import type { Environment } from '@beonauto/config';
import { readDuration } from '@beonauto/workflow-engine';
import { Config, ConfigProvider, Effect } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';

export interface WorkflowSettings {
  readonly mostDurationMs: number;
  readonly mostCallsAtOnce: number;
  readonly sweepEveryMs: number;
}

interface Bounds {
  readonly setting: string;
  readonly least: number;
  readonly most: number;
  readonly expected: string;
}

const hour = 3_600_000;

const wholeNumber = /^\d{1,4}$/u;

const mostDuration: Bounds = {
  setting: 'ORCHESTRATION_MAX_DURATION',
  least: 2 * hour,
  most: 365 * 24 * hour,
  expected: 'Expected an ISO 8601 duration from PT2H to P365D, such as P30D',
};

const sweepInterval: Bounds = {
  setting: 'ORCHESTRATION_SWEEP_INTERVAL',
  least: 10,
  most: 60_000,
  expected: 'Expected an ISO 8601 duration from PT0.01S to PT1M, such as PT1S',
};

const nestedExecutions: Bounds = {
  setting: 'ORCHESTRATION_NESTED_EXECUTIONS',
  least: 1,
  most: 1000,
  expected: 'Expected a whole number from 1 to 1000, such as 32',
};

const sources = Config.all({
  mostDuration: Config.String(mostDuration.setting).pipe(Config.withDefault('P30D')),
  nestedExecutions: Config.String(nestedExecutions.setting).pipe(Config.withDefault('32')),
  sweepInterval: Config.String(sweepInterval.setting).pipe(Config.withDefault('PT1S')),
});

function millisecondsOf(text: string): number {
  return { milliseconds: Number.NaN, ...readDuration(text.trim()) }.milliseconds;
}

export function countOf(text: string): number {
  return wholeNumber.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

function problemOf(value: number, { setting, least, most, expected }: Bounds): readonly string[] {
  return value >= least && value <= most ? [] : [`${setting}: ${expected}`];
}

export function readWorkflowSettings(environment: Environment): Effect.Effect<WorkflowSettings, InvalidSettingsError> {
  return Effect.gen(function* () {
    const source = yield* Effect.orDie(sources.parse(ConfigProvider.fromEnvRecord(environment)));
    const settings = {
      mostDurationMs: millisecondsOf(source.mostDuration),
      mostCallsAtOnce: countOf(source.nestedExecutions),
      sweepEveryMs: millisecondsOf(source.sweepInterval),
    };
    const problems = [
      ...problemOf(settings.mostDurationMs, mostDuration),
      ...problemOf(settings.mostCallsAtOnce, nestedExecutions),
      ...problemOf(settings.sweepEveryMs, sweepInterval),
    ];
    return problems.length === 0
      ? settings
      : yield* Effect.fail(
          new InvalidSettingsError({ message: `The workflow settings are invalid. ${problems.join('; ')}` }),
        );
  });
}
