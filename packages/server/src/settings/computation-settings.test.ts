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

describe('the computation settings', () => {
  it('run four computation functions at once when nothing is set', () => {
    expect(readSettings({}).computation).toEqual({ workers: 4 });
  });

  it('read how many computation functions run at once', () => {
    expect(readSettings({ COMPUTATION_WORKERS: ' 12 ' }).computation).toEqual({ workers: 12 });
  });

  it.each(['0', '65', 'many', '1.5'])(
    'stop the server from starting when the count is %s, naming the setting',
    (workers) => {
      expect(String(errorFrom({ COMPUTATION_WORKERS: workers }))).toBe(
        'InvalidSettingsError: The computation settings are invalid. COMPUTATION_WORKERS: Expected a whole number from 1 to 64, such as 4',
      );
    },
  );
});
