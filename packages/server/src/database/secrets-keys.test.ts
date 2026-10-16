import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { retryStateKeyOf, secretsKeysOf } from './secrets-keys.ts';

function aFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-secrets-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function bytesOfTheKeyIn(file: string): readonly number[] {
  return [...Redacted.value(secretsKeysOf({ key: 'in-a-file', file }).current)];
}

function refusalOf(file: string): string {
  try {
    secretsKeysOf({ key: 'in-a-file', file });
  } catch (error) {
    return String(error);
  }
  return 'no refusal';
}

describe('the secrets key in a file beside the ledger', () => {
  it('is made at the first start, as the base64 of 32 random bytes only its owner may read, and read at the next', () => {
    const file = join(aFolder(), 'not-yet', 'secrets.key');

    const first = bytesOfTheKeyIn(file);
    const written = readFileSync(file, 'utf8');
    const second = bytesOfTheKeyIn(file);

    expect(first).toHaveLength(32);
    expect(written).toBe(`${Buffer.from(first).toString('base64')}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(second).toEqual(first);
    expect(readFileSync(file, 'utf8')).toBe(written);
  });

  it('is read when its owner alone may read it, as 0400 allows', () => {
    const file = join(aFolder(), 'secrets.key');
    writeFileSync(file, Buffer.alloc(32, 3).toString('base64'), { mode: 0o400 });

    expect(bytesOfTheKeyIn(file)).toEqual(Array.from({ length: 32 }, () => 3));
  });

  it('stops the start when others than its owner may read it, naming the file and its mode', () => {
    const file = join(aFolder(), 'secrets.key');
    const key = Buffer.alloc(32, 3).toString('base64');
    writeFileSync(file, key, { mode: 0o600 });
    chmodSync(file, 0o644);

    const refusal = refusalOf(file);

    expect(refusal).toBe(
      `InvalidSettingsError: The secrets settings are invalid. The key file ${file} has the mode 0644, so others than its owner may read it; set it to 0600`,
    );
    expect(refusal).not.toContain(key);
  });

  it.each([
    ['16 bytes', Buffer.alloc(16, 3).toString('base64')],
    ['no base64', 'a key'],
    ['nothing', ''],
  ])('stops the start when it holds %s, naming the file and never what it holds', (_, held) => {
    const file = join(aFolder(), 'secrets.key');
    writeFileSync(file, held, { mode: 0o600 });

    expect(refusalOf(file)).toBe(
      `InvalidSettingsError: The secrets settings are invalid. The key file ${file} holds something other than the base64 of 32 bytes, as openssl rand -base64 32 prints it`,
    );
  });
});

describe('the secrets keys of the other settings', () => {
  it('are the keys SECRETS_KEY and SECRETS_KEY_PREVIOUS give, or a key made at each start', () => {
    const keys = { current: Redacted.make(new Uint8Array(32)) };

    const [first, second] = [secretsKeysOf({ key: 'made-at-start' }), secretsKeysOf({ key: 'made-at-start' })].map(
      ({ current }) => Array.from(Redacted.value(current)),
    );

    expect(secretsKeysOf({ key: 'set', keys })).toBe(keys);
    expect([first?.length, second?.length]).toEqual([32, 32]);
    expect(first).not.toEqual(second);
  });
});

function derivedOf(bytes: Readonly<Uint8Array>): readonly number[] {
  return Array.from(Redacted.value(retryStateKeyOf({ current: Redacted.make(Uint8Array.from(bytes)) })));
}

describe('the key that signs the state of a retry', () => {
  it('is derived from the current secrets key, the same of the same key, and never the key itself', () => {
    const key = new Uint8Array(32).fill(7);

    const [first, again, ofAnother] = [derivedOf(key), derivedOf(key), derivedOf(new Uint8Array(32).fill(9))];

    expect(first).toHaveLength(32);
    expect(again).toEqual(first);
    expect(ofAnother).not.toEqual(first);
    expect(first).not.toEqual(Array.from(key));
  });
});
