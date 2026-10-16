import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readConnectionPolicy } from './connection-policy.ts';

function policyOf(environment: Readonly<Record<string, string>>) {
  return Effect.runSync(readConnectionPolicy(environment));
}

function refusalOf(text: string) {
  return Effect.runSync(Effect.flip(readConnectionPolicy({ CONNECTIONS: text }))).message;
}

describe('the policy of connections', () => {
  it('lets people add any connection when CONNECTIONS is left out or empty', () => {
    const everything = { peopleMayAdd: true, allowedHosts: null, credentialKinds: null };

    expect([policyOf({}), policyOf({ CONNECTIONS: '' })]).toEqual([everything, everything]);
  });

  it('reads the three rules as the file gives them', () => {
    const rules = { people_may_add: false, allowed_hosts: ['*.example.com'], credential_kinds: ['none', 'secret'] };

    expect(policyOf({ CONNECTIONS: JSON.stringify(rules) })).toEqual({
      peopleMayAdd: false,
      allowedHosts: ['*.example.com'],
      credentialKinds: ['none', 'secret'],
    });
  });

  it('stops the server at start for a rule it does not know, a host that is not one and a kind there is not', () => {
    const malformed = { allowed_hosts: ['https://crm.example.com'], credential_kinds: ['token'], maybe: 1 };

    expect(refusalOf(JSON.stringify(malformed))).toBe(
      'The connection settings are invalid. CONNECTIONS: /maybe: Expected no excess property; CONNECTIONS: /allowed_hosts/0: Expected a host, such as crm.example.com, or a host after *. for every host under it; CONNECTIONS: /credential_kinds/0: Expected "none" | "reference" | "secret" | "client_credentials" | "authorization"',
    );
  });
});
