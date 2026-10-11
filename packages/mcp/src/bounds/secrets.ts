import { Redacted } from 'effect';

import type { AuthSettings, McpServerSettings } from '../settings/mcp-settings.ts';

export interface Secrets {
  readonly add: (secret: string) => void;
  readonly scrub: (text: string) => string;
  readonly scrubValue: (value: unknown) => unknown;
}

const leastSecretCharacters = 8;

const redactedMark = '[redacted]';

function scrubbedEntries(
  entries: readonly (readonly [string, unknown])[],
  scrub: (text: string) => string,
): readonly (readonly [string, unknown])[] {
  const kept = new Map<string, unknown>();
  for (const [key, item] of entries) {
    const scrubbedKey = scrub(key);
    if (!kept.has(scrubbedKey)) {
      kept.set(scrubbedKey, scrubbedValueOf(item, scrub));
    }
  }
  return [...kept];
}

function scrubbedValueOf(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return scrub(value);
  }
  if (typeof value === 'number') {
    const digits = String(value);
    const scrubbed = scrub(digits);
    return scrubbed === digits ? value : scrubbed;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubbedValueOf(item, scrub));
  }
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(scrubbedEntries(Object.entries(value), scrub))
    : value;
}

function asInJson(secret: string): string {
  return JSON.stringify(secret).slice(1, -1);
}

export function secretsOf(redacted: readonly Redacted.Redacted[]): Secrets {
  const known = new Set<string>();
  const add = (secret: string): void => {
    if (secret.length >= leastSecretCharacters) {
      known.add(asInJson(asInJson(secret)));
      known.add(asInJson(secret));
      known.add(secret);
    }
  };
  for (const value of redacted) {
    add(Redacted.value(value));
  }
  const scrub = (text: string): string =>
    [...known].reduce((scrubbed, secret) => scrubbed.replaceAll(secret, redactedMark), text);
  return { add, scrub, scrubValue: (value) => scrubbedValueOf(value, scrub) };
}

function credentialOf(auth: AuthSettings | null): readonly Redacted.Redacted[] {
  if (auth === null) {
    return [];
  }
  const { credential } = auth;
  return [credential.kind === 'client_secret' ? credential.client_secret : credential.private_key];
}

function authOf(server: McpServerSettings): AuthSettings | null {
  return server.type === 'http' ? server.auth : null;
}

export function secretsOfServers(servers: readonly McpServerSettings[]): Secrets {
  return secretsOf(servers.flatMap((server) => [...server.secrets, ...credentialOf(authOf(server))]));
}
