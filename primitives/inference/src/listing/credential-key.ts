import { createHash } from 'node:crypto';

import { Redacted } from 'effect';

export type CredentialIdentity = readonly (string | null | CredentialIdentity)[];

export function credentialKey(provider: string, identity: CredentialIdentity): string {
  return `${provider}:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export function secretPairsOf(values: ReadonlyMap<string, Redacted.Redacted>): CredentialIdentity {
  return [...values].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]);
}
