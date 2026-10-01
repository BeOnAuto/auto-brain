import { ConfigProvider, Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionOptionsOf, TemporalSettingsConfig } from './temporal-settings.ts';

function settingsFrom(env: Readonly<Record<string, string>>) {
  return Effect.runSync(TemporalSettingsConfig.parse(ConfigProvider.fromEnv({ env })));
}

describe('the Temporal settings', () => {
  it('are none when no address is set, so the server runs without orchestration', () => {
    expect(settingsFrom({})).toEqual(Option.none());
    expect(settingsFrom({ TEMPORAL_ADDRESS: '  ' })).toEqual(Option.none());
  });

  it('default the namespace, the task queue and TLS', () => {
    expect(settingsFrom({ TEMPORAL_ADDRESS: 'temporal:7233' })).toEqual(
      Option.some({ address: 'temporal:7233', namespace: 'default', taskQueue: 'auto-brain', tls: false }),
    );
  });

  it('read every setting', () => {
    const settings = settingsFrom({
      TEMPORAL_ADDRESS: 'acme.tmprl.cloud:7233',
      TEMPORAL_NAMESPACE: 'acme.prod',
      TEMPORAL_TASK_QUEUE: 'brains',
      TEMPORAL_API_KEY: 'secret',
      TEMPORAL_TLS: 'false',
    });

    expect(Option.map(settings, ({ apiKey, ...rest }) => ({ ...rest, apiKey: apiKey?.() }))).toEqual(
      Option.some({
        address: 'acme.tmprl.cloud:7233',
        namespace: 'acme.prod',
        taskQueue: 'brains',
        tls: false,
        apiKey: 'secret',
      }),
    );
  });
});

describe('the connection to Temporal', () => {
  it('uses TLS when told to, and always with an API key', () => {
    const plain = { address: 'temporal:7233', namespace: 'default', taskQueue: 'auto-brain', tls: false };

    expect(connectionOptionsOf(plain)).toEqual({ address: 'temporal:7233', tls: false });
    expect(connectionOptionsOf({ ...plain, tls: true })).toEqual({ address: 'temporal:7233', tls: true });
    expect(connectionOptionsOf({ ...plain, apiKey: () => 'secret' })).toEqual({
      address: 'temporal:7233',
      tls: true,
      apiKey: 'secret',
    });
  });

  it('keeps the API key out of what the settings print', () => {
    const settings = settingsFrom({ TEMPORAL_ADDRESS: 'temporal:7233', TEMPORAL_API_KEY: 'secret' });

    expect(JSON.stringify(settings)).not.toContain('secret');
  });
});
