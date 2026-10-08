import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';

const openRequestsRefused =
  'InvalidSettingsError: The interaction settings are invalid. INTERACTION_OPEN_REQUESTS: Expected a whole number from 1 to 1000000, such as 10000';

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettings(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

describe('the interaction function settings', () => {
  it('read the most open requests a brain may hold, 10,000 unless set', () => {
    expect(
      [{}, { INTERACTION_OPEN_REQUESTS: '500' }, { INTERACTION_OPEN_REQUESTS: '1000000' }].map(
        (environment: Readonly<Record<string, string>>) => readSettings(environment).interaction.mostOpenRequests,
      ),
    ).toEqual([10_000, 500, 1_000_000]);
  });

  it.each(['0', 'many', '1000001'])('stop the server from starting at %s open requests', (most) => {
    expect(errorFrom({ INTERACTION_OPEN_REQUESTS: most })).toBe(openRequestsRefused);
  });

  it('start as if neither were set when the environment still names CHANNELS or PUBLIC_ORIGIN', () => {
    expect(readSettings({ CHANNELS: '{ not even JSON', PUBLIC_ORIGIN: 'nowhere' }).interaction).toEqual(
      readSettings({}).interaction,
    );
  });
});
