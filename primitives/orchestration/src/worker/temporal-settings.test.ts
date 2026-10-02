import { ConfigProvider, Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionOptionsOf, TemporalSettingsConfig } from './temporal-settings.ts';

const thirtyDays = 2_592_000_000;

function settingsFrom(env: Readonly<Record<string, string>>) {
  return Effect.runSync(TemporalSettingsConfig.parse(ConfigProvider.fromEnv({ env })));
}

function problemOf(env: Readonly<Record<string, string>>): string {
  return Effect.runSync(
    Effect.flip(TemporalSettingsConfig.parse(ConfigProvider.fromEnv({ env }))).pipe(Effect.map(String)),
  );
}

describe('the Temporal settings', () => {
  it('are none when no address is set, so the server runs without orchestration', () => {
    expect(settingsFrom({})).toEqual(Option.none());
    expect(settingsFrom({ TEMPORAL_ADDRESS: '  ' })).toEqual(Option.none());
  });

  it('default the namespace, the task queue, TLS, and the most a workflow may run to 30 days', () => {
    expect(settingsFrom({ TEMPORAL_ADDRESS: 'temporal:7233' })).toEqual(
      Option.some({
        address: 'temporal:7233',
        namespace: 'default',
        taskQueue: 'auto-brain',
        tls: false,
        mostDuration: thirtyDays,
      }),
    );
  });

  it('read every setting', () => {
    const settings = settingsFrom({
      TEMPORAL_ADDRESS: 'acme.tmprl.cloud:7233',
      TEMPORAL_NAMESPACE: 'acme.prod',
      TEMPORAL_TASK_QUEUE: 'brains',
      TEMPORAL_API_KEY: 'secret',
      TEMPORAL_TLS: 'false',
      ORCHESTRATION_MAX_DURATION: 'P365D',
    });

    expect(Option.map(settings, ({ apiKey, ...rest }) => ({ ...rest, apiKey: apiKey?.() }))).toEqual(
      Option.some({
        address: 'acme.tmprl.cloud:7233',
        namespace: 'acme.prod',
        taskQueue: 'brains',
        tls: false,
        mostDuration: 31_536_000_000,
        apiKey: 'secret',
      }),
    );
  });
});

describe('the most a workflow may run', () => {
  it.each(['P1Y', 'P366D', 'PT1H', 'soon'])('is checked when the server starts, so %s fails', (duration) => {
    expect(problemOf({ TEMPORAL_ADDRESS: 'temporal:7233', ORCHESTRATION_MAX_DURATION: duration })).toContain(
      'ORCHESTRATION_MAX_DURATION is',
    );
  });

  it('may be as short as two hours', () => {
    expect(
      Option.map(
        settingsFrom({ TEMPORAL_ADDRESS: 'temporal:7233', ORCHESTRATION_MAX_DURATION: 'PT2H' }),
        ({ mostDuration }) => mostDuration,
      ),
    ).toEqual(Option.some(7_200_000));
  });
});

describe('the connection to Temporal', () => {
  it('uses TLS when told to, and always with an API key', () => {
    const plain = {
      address: 'temporal:7233',
      namespace: 'default',
      taskQueue: 'auto-brain',
      tls: false,
      mostDuration: thirtyDays,
    };

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
