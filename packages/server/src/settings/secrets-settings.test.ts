import type { Environment } from '@on.auto/config';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SecretsSettings } from './secrets-settings.ts';
import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): string {
  try {
    readSettings(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

function revealed(secrets: SecretsSettings): unknown {
  if (secrets.key !== 'set') {
    return secrets;
  }
  const { current, previous } = secrets.keys;
  return {
    current: [...Redacted.value(current)],
    previous: previous === undefined ? previous : [...Redacted.value(previous)],
  };
}

const current = Buffer.alloc(32, 1).toString('base64');

const previous = Buffer.alloc(32, 2).toString('base64');

const databaseUrl = 'postgresql://playbooks:a-secret-password@db.example.com:5432/playbooks';

const refusedAs = 'InvalidSettingsError: The secrets settings are invalid.';

const aKeyInWords = 'the base64 of 32 bytes, as openssl rand -base64 32 prints it';

describe('the secrets settings', () => {
  it('keep the key in secrets.key beside the ledger file when SECRETS_KEY is not set', () => {
    expect([readSettings({}).secrets, readSettings({ LEDGER_FILE: '/data/playbooks.db' }).secrets]).toEqual([
      { key: 'in-a-file', file: 'data/secrets.key' },
      { key: 'in-a-file', file: '/data/secrets.key' },
    ]);
  });

  it('make a key at start for a private ledger in memory, which no file outlasts', () => {
    expect(readSettings({ LEDGER_FILE: ':memory:' }).secrets).toEqual({ key: 'made-at-start' });
  });

  it('read SECRETS_KEY and SECRETS_KEY_PREVIOUS as the bytes their base64 gives, around any whitespace', () => {
    const given = readSettings({ SECRETS_KEY: ` ${current}\n`, SECRETS_KEY_PREVIOUS: previous }).secrets;
    const alone = readSettings({ SECRETS_KEY: current, DATABASE_URL: databaseUrl }).secrets;

    expect([revealed(given), revealed(alone)]).toEqual([
      { current: Array.from({ length: 32 }, () => 1), previous: Array.from({ length: 32 }, () => 2) },
      { current: Array.from({ length: 32 }, () => 1), previous: undefined },
    ]);
    expect(JSON.stringify(given)).not.toContain(current);
  });
});

describe('the secrets settings that cannot be read', () => {
  it.each([
    ['not base64', 'not a key at all!'],
    ['16 bytes', Buffer.alloc(16, 1).toString('base64')],
    ['33 bytes', Buffer.alloc(33, 1).toString('base64')],
    ['base64url', Buffer.alloc(32, 255).toString('base64url')],
    ['base64 without its padding', current.replace('=', '')],
  ])('stop the server at start for a SECRETS_KEY of %s, naming the setting and never its value', (_, value) => {
    const error = errorFrom({ SECRETS_KEY: value });

    expect(error).toBe(`${refusedAs} SECRETS_KEY: Expected ${aKeyInWords}`);
    expect(error).not.toContain(value);
  });

  it('stop the server at start for a SECRETS_KEY_PREVIOUS that is not the base64 of 32 bytes', () => {
    expect(errorFrom({ SECRETS_KEY: current, SECRETS_KEY_PREVIOUS: 'short' })).toBe(
      `${refusedAs} SECRETS_KEY_PREVIOUS: Expected ${aKeyInWords}`,
    );
  });

  it('stop the server at start for SECRETS_KEY_PREVIOUS without SECRETS_KEY', () => {
    expect(errorFrom({ SECRETS_KEY_PREVIOUS: previous })).toBe(
      `${refusedAs} SECRETS_KEY_PREVIOUS: Set it only beside SECRETS_KEY, to the key that SECRETS_KEY replaces`,
    );
  });

  it('stop the server at start for a ledger in PostgreSQL without SECRETS_KEY, naming the setting and no URL', () => {
    const error = errorFrom({ DATABASE_URL: databaseUrl });

    expect(error).toBe(
      `${refusedAs} SECRETS_KEY: Set it when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks`,
    );
    expect(error).not.toMatch(/a-secret-password|db\.example\.com/u);
  });
});
