import { InvalidPortError, type Environment } from '@beonauto/config';
import { createApiKey } from '@beonauto/identity';
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

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], brains: '*' });

describe('the workflow settings', () => {
  it('are none when TEMPORAL_ADDRESS is unset, so workflows are not offered', () => {
    expect(readSettings({}).workflows).toBeUndefined();
  });

  it('name the Temporal server, namespace and task queue when TEMPORAL_ADDRESS is set', () => {
    expect(readSettings({ TEMPORAL_ADDRESS: 'temporal:7233', TEMPORAL_TASK_QUEUE: 'brains' }).workflows).toEqual({
      address: 'temporal:7233',
      namespace: 'default',
      taskQueue: 'brains',
      tls: false,
      mostDuration: 2_592_000_000,
      nestedExecutions: 32,
    });
  });

  it('stop the server from starting when one is malformed, naming the setting and never its value', () => {
    const error = errorFrom({ TEMPORAL_ADDRESS: 'temporal:7233', ORCHESTRATION_MAX_DURATION: 'secret-forever' });

    expect(String(error)).toBe(
      'temporal_settings_invalid: The Temporal settings are invalid. ORCHESTRATION_MAX_DURATION: Expected an ISO 8601 duration from PT2H to P365D, such as P30D',
    );
  });
});

describe('readSettings', () => {
  it('listens on every interface at port 8080, allows no origin, has no API keys and keeps the ledger in data/ by default', () => {
    const { models, ...server } = readSettings({});

    expect(models.openai).toEqual({ configured: false, missing: ['OPENAI_API_KEY'] });
    expect(server).toEqual({
      host: '0.0.0.0',
      port: 8080,
      allowedOrigins: [],
      apiKeys: undefined,
      ledger: { store: 'sqlite', file: 'data/ledger.db' },
      localMode: false,
      logFormat: 'json',
    });
  });

  it('reads every setting from the environment it is given', () => {
    const { models, ...server } = readSettings({
      HOST: '127.0.0.1',
      PORT: '3000',
      ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:5173,http://[::1]:3000',
      API_KEYS: JSON.stringify([entry]),
      LEDGER_FILE: '/data/ledger.db',
      LOCAL_MODE: 'true',
      LOG_FORMAT: 'pretty',
      OPENAI_API_KEY: 'sk-test',
    });

    expect(models.openai).toMatchObject({ configured: true });
    expect(server).toEqual({
      host: '127.0.0.1',
      port: 3000,
      allowedOrigins: ['https://app.example.com', 'http://localhost:5173', 'http://[::1]:3000'],
      apiKeys: [entry],
      ledger: { store: 'sqlite', file: '/data/ledger.db' },
      localMode: true,
      logFormat: 'pretty',
      configFile: undefined,
    });
  });
});

describe('readSettings with empty values', () => {
  it('treats empty variables as not set', () => {
    expect(
      readSettings({ ALLOWED_ORIGINS: '', API_KEYS: '', LEDGER_FILE: '', LOCAL_MODE: '', LOG_FORMAT: '' }),
    ).toMatchObject({
      allowedOrigins: [],
      apiKeys: undefined,
      ledger: { store: 'sqlite', file: 'data/ledger.db' },
      localMode: false,
      logFormat: 'json',
    });
  });

  it.each([' ', '\t', '  \n  '])('treats API_KEYS=%j, only whitespace, as no API keys', (keys) => {
    expect(readSettings({ API_KEYS: keys })).toMatchObject({ apiKeys: undefined });
  });
});

describe('readSettings rejects invalid settings', () => {
  it.each([
    'https://app.example.com/',
    'app.example.com',
    'https://App.example.com',
    'https://app.example.com:443',
    ' https://app.example.com',
    'null',
    '*',
    'https://a.example,,https://b.example',
  ])('rejects ALLOWED_ORIGINS="%s" with a named error', (origins) => {
    const error = errorFrom({ ALLOWED_ORIGINS: origins });

    expect(error).toMatchObject({ name: 'InvalidSettingsError', _tag: 'InvalidSettingsError' });
    expect(String(error)).toContain('ALLOWED_ORIGINS');
    expect(String(error)).toContain('Expected an origin such as https://app.example.com');
  });

  it.each(['enabled', 'TRUE!', '2'])('rejects LOCAL_MODE="%s", which is not a boolean, with a named error', (value) => {
    const error = errorFrom({ LOCAL_MODE: value });

    expect(error).toMatchObject({ name: 'InvalidSettingsError' });
    expect(String(error)).toContain('LOCAL_MODE');
  });

  it.each(['text', 'JSON', 'logfmt'])('rejects LOG_FORMAT="%s", naming the formats it accepts', (value) => {
    const error = errorFrom({ LOG_FORMAT: value });

    expect(error).toMatchObject({ name: 'InvalidSettingsError' });
    expect(String(error)).toBe('InvalidSettingsError: SchemaError(Expected "json" | "pretty"\n  at ["LOG_FORMAT"])');
  });

  it('rejects invalid API keys with the named error from the identity settings', () => {
    expect(String(errorFrom({ API_KEYS: '[{"id":"ci-1"}]' }))).toContain('InvalidApiKeysError: API_KEYS[0].org');
  });

  it('rejects an invalid port with the named error from the server configuration', () => {
    expect(errorFrom({ PORT: 'eighty' })).toEqual(new InvalidPortError('eighty'));
  });

  it('stops at model settings it cannot read, naming the setting and never its value', () => {
    const error = String(errorFrom({ MODEL_ALIASES: '{"fast": "sk-not-a-reference"}' }));

    expect(error).toBe(
      'model_settings_invalid: The model settings are invalid. MODEL_ALIASES: /fast: An alias and its target are each written provider/model',
    );
    expect(error).not.toContain('sk-not-a-reference');
  });
});
