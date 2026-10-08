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

describe('the recall function settings', () => {
  it('keep at most 32 recall functions a brain, build 4 views of a brain at once and follow 4 brains at once when nothing is set', () => {
    expect(readSettings({}).recall).toEqual({ mostFunctions: 32, rebuildsAtOnce: 4, brainsAtOnce: 4 });
  });

  it('read each of the three', () => {
    expect(
      readSettings({
        RECOLLECTION_MAX_FUNCTIONS: ' 100 ',
        RECOLLECTION_MAX_REBUILDS: '2',
        RECOLLECTION_BRAINS_AT_ONCE: '8',
      }).recall,
    ).toEqual({ mostFunctions: 100, rebuildsAtOnce: 2, brainsAtOnce: 8 });
  });

  it('stop the server from starting when one is out of its range or not a whole number, naming each', () => {
    expect(
      String(
        errorFrom({
          RECOLLECTION_MAX_FUNCTIONS: '0',
          RECOLLECTION_MAX_REBUILDS: '65',
          RECOLLECTION_BRAINS_AT_ONCE: 'many',
        }),
      ),
    ).toBe(
      'InvalidSettingsError: The recall function settings are invalid. RECOLLECTION_MAX_FUNCTIONS: Expected a whole number from 1 to 1000, such as 32; RECOLLECTION_MAX_REBUILDS: Expected a whole number from 1 to 64, such as 4; RECOLLECTION_BRAINS_AT_ONCE: Expected a whole number from 1 to 64, such as 4',
    );
  });
});
