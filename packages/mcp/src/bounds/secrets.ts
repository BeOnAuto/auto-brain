import { Redacted } from 'effect';

import type { AuthSettings, McpServerSettings } from '../settings/mcp-settings.ts';

export interface Secrets {
  readonly add: (secret: string) => void;
  readonly scrub: (text: string) => string;
}

const leastSecretCharacters = 8;

const redactedMark = '[redacted]';

export function secretsOf(redacted: readonly Redacted.Redacted[]): Secrets {
  const known = new Set<string>();
  const add = (secret: string): void => {
    if (secret.length >= leastSecretCharacters) {
      known.add(secret);
    }
  };
  for (const value of redacted) {
    add(Redacted.value(value));
  }
  return {
    add,
    scrub: (text) => [...known].reduce((scrubbed, secret) => scrubbed.replaceAll(secret, redactedMark), text),
  };
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
