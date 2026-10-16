import { sha256Of } from '@on.auto/operations';
import { Redacted } from 'effect';

export const secretKeyBytes = 32;

const kidLength = 16;

export interface SecretKeys {
  readonly current: Redacted.Redacted<Uint8Array>;
  readonly previous?: Redacted.Redacted<Uint8Array> | undefined;
}

export interface SealingKey {
  readonly kid: string;
  readonly bytes: Redacted.Redacted<Uint8Array>;
}

export interface Keyring {
  readonly current: SealingKey;
  readonly previous: SealingKey | undefined;
  readonly named: (kid: string) => SealingKey | undefined;
}

function sealingKeyOf(bytes: Redacted.Redacted<Uint8Array>): SealingKey {
  const { byteLength } = Redacted.value(bytes);
  if (byteLength !== secretKeyBytes) {
    throw new Error(`A key that seals secrets is ${secretKeyBytes} bytes, and this one is ${byteLength}`);
  }
  return { kid: sha256Of(Redacted.value(bytes)).slice(0, kidLength), bytes };
}

function anotherKey(current: SealingKey, previous: SealingKey | undefined): SealingKey | undefined {
  return previous?.kid === current.kid ? undefined : previous;
}

export function keyringOf({ current, previous }: SecretKeys): Keyring {
  const sealing = sealingKeyOf(current);
  const unsealing = anotherKey(sealing, previous === undefined ? undefined : sealingKeyOf(previous));
  const known = unsealing === undefined ? [sealing] : [sealing, unsealing];
  return { current: sealing, previous: unsealing, named: (kid) => known.find((key) => key.kid === kid) };
}
