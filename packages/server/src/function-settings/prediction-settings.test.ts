import type { Environment } from '@beonauto/config';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettings(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('the prediction function settings', () => {
  it('keep 4 model processes of 512 MiB each, 2 of them for builds, when nothing is set', () => {
    expect(readSettings({}).prediction).toEqual({ processes: 4, processMemoryMebibytes: 512, buildsAtOnce: 2 });
  });

  it('read each of the three', () => {
    expect(
      readSettings({
        PREDICTION_PROCESSES: ' 8 ',
        PREDICTION_PROCESS_MEMORY: '1024',
        PREDICTION_BUILDS_AT_ONCE: '3',
      }).prediction,
    ).toEqual({ processes: 8, processMemoryMebibytes: 1024, buildsAtOnce: 3 });
  });

  it('stop the server from starting when one is out of its range or not a whole number, naming each', () => {
    expect(
      String(
        errorFrom({
          PREDICTION_PROCESSES: '1',
          PREDICTION_PROCESS_MEMORY: '16385',
          PREDICTION_BUILDS_AT_ONCE: 'many',
        }),
      ),
    ).toBe(
      'InvalidSettingsError: The prediction function settings are invalid. PREDICTION_PROCESSES: Expected a whole number from 2 to 64, such as 4; PREDICTION_PROCESS_MEMORY: Expected a whole number from 128 to 16384, such as 512; PREDICTION_BUILDS_AT_ONCE: Expected a whole number from 1 to 63, such as 2',
    );
  });

  it.each([
    ['as many builds at once as there are processes', '4'],
    ['more builds at once than there are processes', '5'],
  ])(
    'stop the server from starting when they keep %s, so that a prediction always finds a process',
    (_what, builds) => {
      expect(String(errorFrom({ PREDICTION_PROCESSES: '4', PREDICTION_BUILDS_AT_ONCE: builds }))).toBe(
        'InvalidSettingsError: The prediction function settings are invalid. PREDICTION_BUILDS_AT_ONCE: Expected a whole number below PREDICTION_PROCESSES, 4, so that a prediction always finds a model process',
      );
    },
  );
});
