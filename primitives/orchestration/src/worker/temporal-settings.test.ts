import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionOptionsOf, readTemporalSettings, type TemporalSettingsInvalid } from './temporal-settings.ts';

const thirtyDays = 2_592_000_000;

const reachable = { TEMPORAL_ADDRESS: 'temporal:7233' };

function settingsFrom(environment: Readonly<Record<string, string>>) {
  return Effect.runSync(readTemporalSettings(environment));
}

function problemOf(environment: Readonly<Record<string, string>>): TemporalSettingsInvalid {
  return Effect.runSync(Effect.flip(readTemporalSettings(environment)));
}

describe('the Temporal settings', () => {
  it('are none when no address is set, so the server runs without orchestration', () => {
    expect(settingsFrom({})).toEqual(Option.none());
    expect(settingsFrom({ TEMPORAL_ADDRESS: '  ', TEMPORAL_TLS: 'perhaps' })).toEqual(Option.none());
  });

  it('default the namespace, the task queue, TLS, and the most a workflow may run to 30 days', () => {
    expect(settingsFrom(reachable)).toEqual(
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
      TEMPORAL_ADDRESS: ' acme.tmprl.cloud:7233 ',
      TEMPORAL_NAMESPACE: 'acme.prod',
      TEMPORAL_TASK_QUEUE: 'brains',
      TEMPORAL_API_KEY: 'secret',
      TEMPORAL_TLS: 'Yes',
      ORCHESTRATION_MAX_DURATION: 'P365D',
      ORCHESTRATION_WORKFLOW_BUNDLE: ' /app/workflow-bundle ',
    });

    expect(Option.map(settings, ({ apiKey, ...rest }) => ({ ...rest, apiKey: apiKey?.() }))).toEqual(
      Option.some({
        address: 'acme.tmprl.cloud:7233',
        namespace: 'acme.prod',
        taskQueue: 'brains',
        tls: true,
        mostDuration: 31_536_000_000,
        workflowBundle: '/app/workflow-bundle',
        apiKey: 'secret',
      }),
    );
  });

  it.each(['localhost:7233', '10.0.0.7:7233', '[::1]:7233', 'acme.tmprl.cloud:7233'])(
    'accept the address %s',
    (address) => {
      expect(Option.isSome(settingsFrom({ TEMPORAL_ADDRESS: address }))).toBe(true);
    },
  );
});

describe('Temporal settings that cannot be read', () => {
  it('name every setting that is wrong and what it expects, and never its value', () => {
    const problem = problemOf({
      TEMPORAL_ADDRESS: 'https://secret-host/temporal',
      TEMPORAL_NAMESPACE: ' ',
      TEMPORAL_TASK_QUEUE: ' ',
      TEMPORAL_TLS: 'secret-yes',
      ORCHESTRATION_MAX_DURATION: 'secret-soon',
    });

    expect(String(problem)).toBe(
      'temporal_settings_invalid: The Temporal settings are invalid. TEMPORAL_ADDRESS: Expected host:port, such as temporal:7233; TEMPORAL_NAMESPACE: Expected the name of a namespace; TEMPORAL_TASK_QUEUE: Expected the name of a task queue; TEMPORAL_TLS: Expected true or false; ORCHESTRATION_MAX_DURATION: Expected an ISO 8601 duration from PT2H to P365D, such as P30D',
    );
    expect(problem.problems.map(({ setting }) => setting)).toEqual([
      'TEMPORAL_ADDRESS',
      'TEMPORAL_NAMESPACE',
      'TEMPORAL_TASK_QUEUE',
      'TEMPORAL_TLS',
      'ORCHESTRATION_MAX_DURATION',
    ]);
  });

  it.each(['temporal', 'temporal:port', ':7233'])('reject the address %s', (address) => {
    expect(problemOf({ TEMPORAL_ADDRESS: address }).problems).toEqual([
      { setting: 'TEMPORAL_ADDRESS', detail: 'Expected host:port, such as temporal:7233' },
    ]);
  });
});

describe('the most a workflow may run', () => {
  it.each(['P1Y', 'P366D', 'PT1H', 'soon'])('is checked when the server starts, so %s fails', (duration) => {
    expect(problemOf({ ...reachable, ORCHESTRATION_MAX_DURATION: duration }).problems).toEqual([
      expect.objectContaining({ setting: 'ORCHESTRATION_MAX_DURATION' }),
    ]);
  });

  it('may be as short as two hours', () => {
    expect(
      Option.map(
        settingsFrom({ ...reachable, ORCHESTRATION_MAX_DURATION: 'PT2H' }),
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
    const settings = settingsFrom({ ...reachable, TEMPORAL_API_KEY: 'secret' });

    expect(JSON.stringify(settings)).not.toContain('secret');
  });
});
