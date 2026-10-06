import type { Environment } from '@beonauto/config';
import { describe, expect, it } from 'vitest';

import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettings(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('the workflow settings', () => {
  it('let a run last 30 days, run 32 calls at once and sweep every second when nothing is set', () => {
    expect(readSettings({}).workflows).toEqual({
      mostDurationMs: 2_592_000_000,
      mostCallsAtOnce: 32,
      sweepEveryMs: 1000,
    });
  });

  it('read how long a run may last, how many calls run at once and how often the runs are swept', () => {
    const workflows = readSettings({
      ORCHESTRATION_MAX_DURATION: 'P7D',
      ORCHESTRATION_NESTED_EXECUTIONS: '8',
      ORCHESTRATION_SWEEP_INTERVAL: 'PT0.25S',
    }).workflows;

    expect(workflows).toEqual({ mostDurationMs: 604_800_000, mostCallsAtOnce: 8, sweepEveryMs: 250 });
  });

  it('stop the server from starting when one is malformed or out of bounds, naming each and never its value', () => {
    const error = errorFrom({
      ORCHESTRATION_MAX_DURATION: 'secret-forever',
      ORCHESTRATION_NESTED_EXECUTIONS: '1001',
      ORCHESTRATION_SWEEP_INTERVAL: 'PT2M',
    });

    expect(String(error)).toBe(
      'InvalidSettingsError: The workflow settings are invalid. ORCHESTRATION_MAX_DURATION: Expected an ISO 8601 duration from PT2H to P365D, such as P30D; ORCHESTRATION_NESTED_EXECUTIONS: Expected a whole number from 1 to 1000, such as 32; ORCHESTRATION_SWEEP_INTERVAL: Expected an ISO 8601 duration from PT0.01S to PT1M, such as PT1S',
    );
  });

  it('refuse a count of calls that is not a whole number', () => {
    expect(String(errorFrom({ ORCHESTRATION_NESTED_EXECUTIONS: 'many' }))).toContain(
      'ORCHESTRATION_NESTED_EXECUTIONS: Expected a whole number from 1 to 1000',
    );
  });
});
