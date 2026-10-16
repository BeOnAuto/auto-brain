import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fileOf(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-connections-'));
  directories.push(directory);
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

function refusalOf(path: string): string {
  try {
    readSettings({ CONFIG_FILE: path });
  } catch (error) {
    return String(error).replaceAll(path, 'auto-runtime.yaml');
  }
  return 'read';
}

const policy = `connections:
  people_may_add: true
  allowed_hosts: ['*.example.com', 'crm.example.com']
  credential_kinds: [none, reference, secret, client_credentials]
`;

describe('the connections section of the configuration file', () => {
  it('is read as the policy of what people may add, its kinds of credential not taken for credentials', () => {
    expect(readSettings({ CONFIG_FILE: fileOf(policy) }).connections).toEqual({
      peopleMayAdd: true,
      allowedHosts: ['*.example.com', 'crm.example.com'],
      credentialKinds: ['none', 'reference', 'secret', 'client_credentials'],
    });
  });

  it('stops the start at the place of a rule it does not accept', () => {
    const malformed = `connections:\n  people_may_add: sometimes\n  allowed_hosts: ['https://crm.example.com']\n  maybe: 1\n`;

    expect(refusalOf(fileOf(malformed))).toBe(
      'ConfigFileInvalid: The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:2:19 connections.people_may_add: Expected boolean; auto-runtime.yaml:3:19 connections.allowed_hosts[0]: Expected a host, such as crm.example.com, or a host after *. for every host under it; auto-runtime.yaml:4:10 connections.maybe: Expected no excess property',
    );
  });
});
