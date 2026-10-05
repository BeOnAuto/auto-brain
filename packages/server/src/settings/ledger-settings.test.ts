import { inspect } from 'node:util';

import type { Environment } from '@beonauto/config';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LedgerSettings } from './ledger-settings.ts';
import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettings(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

function revealed(ledger: LedgerSettings): unknown {
  return ledger.store === 'postgresql' ? { ...ledger, url: Redacted.value(ledger.url) } : ledger;
}

const password = 'a-secret-password';

const databaseUrl = `postgresql://brains:${password}@db.example.com:5432/brains`;

describe('the ledger settings', () => {
  it('keep the ledger in PostgreSQL when DATABASE_URL is set, naming its host and database', () => {
    expect(revealed(readSettings({ DATABASE_URL: databaseUrl }).ledger)).toEqual({
      store: 'postgresql',
      url: databaseUrl,
      host: 'db.example.com:5432',
      database: 'brains',
    });
  });

  it('accept a URL that starts postgres: as well as postgresql:', () => {
    expect(readSettings({ DATABASE_URL: 'postgres://brains@10.0.0.7/ledger' }).ledger).toMatchObject({
      store: 'postgresql',
      host: '10.0.0.7',
      database: 'ledger',
    });
  });

  it('hold DATABASE_URL redacted, so the settings never print it', () => {
    const settings = readSettings({ DATABASE_URL: databaseUrl });

    expect(JSON.stringify(settings.ledger)).toBe(
      '{"store":"postgresql","url":"<redacted>","host":"db.example.com:5432","database":"brains"}',
    );
    expect(inspect(settings, { depth: Number.POSITIVE_INFINITY })).not.toContain(password);
  });

  it('keep the ledger in the SQLite file of LEDGER_FILE when DATABASE_URL is empty', () => {
    expect(readSettings({ DATABASE_URL: '', LEDGER_FILE: '/data/brains.db' }).ledger).toEqual({
      store: 'sqlite',
      file: '/data/brains.db',
    });
  });
});

describe('ledger settings the server cannot use', () => {
  it('stop the server from starting when both DATABASE_URL and LEDGER_FILE are set, naming both and neither value', () => {
    const error = String(errorFrom({ DATABASE_URL: databaseUrl, LEDGER_FILE: '/data/ledger.db' }));

    expect(error).toBe(
      'InvalidSettingsError: The ledger settings are invalid. DATABASE_URL: Set DATABASE_URL or LEDGER_FILE, not both',
    );
  });

  it.each([
    `brains:${password}@db.example.com/brains`,
    `mysql://brains:${password}@db.example.com/brains`,
    `postgresql://brains:${password}@/brains`,
    'postgresql:///brains',
    `postgresql://brains:${password}@db.example.com`,
    `postgresql://brains:${password}@db.example.com/`,
  ])('stop the server from starting when DATABASE_URL is %s, which names no PostgreSQL database', (url) => {
    const error = String(errorFrom({ DATABASE_URL: url }));

    expect(error).toBe(
      'InvalidSettingsError: The ledger settings are invalid. DATABASE_URL: Expected a PostgreSQL URL such as postgresql://user:password@host:5432/database',
    );
  });
});
