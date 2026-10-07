import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from './settings.ts';

const partner = {
  type: 'webhook',
  url: 'https://partner.example.com/brain/requests',
  secret: '${PARTNER_WEBHOOK_SECRET}',
  to: '^[a-z]+@partner\\.example\\.com$',
  org: 'acme',
};

const secrets = { PARTNER_WEBHOOK_SECRET: 'whsec_cGFydG5lci13ZWJob29rLXNlY3JldC0wMTIzNDU2Nzg5' };

const openRequestsRefused =
  'InvalidSettingsError: The interaction settings are invalid. INTERACTION_OPEN_REQUESTS: Expected a whole number from 1 to 1000000, such as 10000';

const refusals: readonly (readonly [Readonly<Record<string, string>>, string])[] = [
  [{ INTERACTION_OPEN_REQUESTS: '0' }, openRequestsRefused],
  [{ INTERACTION_OPEN_REQUESTS: 'many' }, openRequestsRefused],
  [{ INTERACTION_OPEN_REQUESTS: '1000001' }, openRequestsRefused],
  [
    { PUBLIC_ORIGIN: 'https://brains.example.com/' },
    'InvalidSettingsError: The interaction settings are invalid. PUBLIC_ORIGIN: Expected an origin such as https://brains.example.com',
  ],
];

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettings(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-brain-channels-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-brain.yaml');
  writeFileSync(path, text);
  return path;
}

describe('the interaction function settings', () => {
  it('read the channels from the environment or the file, and the most open requests and the public origin', () => {
    const fromEnvironment = readSettings({
      ...secrets,
      CHANNELS: JSON.stringify({ partner }),
      INTERACTION_OPEN_REQUESTS: '500',
      PUBLIC_ORIGIN: 'https://brains.example.com',
    }).interaction;
    const fromFile = readSettings({
      ...secrets,
      CONFIG_FILE: configFile(`channels:\n  partner: ${JSON.stringify(partner)}\n`),
    }).interaction;

    expect([...fromEnvironment.channels.channels.keys(), ...fromFile.channels.channels.keys()]).toEqual([
      'partner',
      'partner',
    ]);
    expect(fromEnvironment).toMatchObject({ mostOpenRequests: 500, origin: 'https://brains.example.com' });
  });
});

describe('interaction function settings the server refuses', () => {
  it('stop the server from starting at a channel it refuses, placing it in the file when the file holds it', () => {
    const unknownServer = {
      type: 'mcp',
      server: 'slack',
      tool: 'post_message',
      to: '^#approvals$',
      with: { text: '{{ message }}' },
      org: 'acme',
    };

    const file = configFile(`channels:\n  approvals: ${JSON.stringify(unknownServer)}\n`);
    const refused = 'channel_settings_invalid: The channel settings are invalid.';
    const detail = 'Expected an MCP server of mcp_servers; slack is not one';

    expect([
      errorFrom({ CHANNELS: JSON.stringify({ approvals: unknownServer }) }),
      errorFrom({ CONFIG_FILE: file }).replaceAll(file, 'auto-brain.yaml'),
    ]).toEqual([
      `${refused} CHANNELS: /approvals/server: ${detail}`,
      `${refused} auto-brain.yaml:2:37 channels.approvals.server: ${detail}`,
    ]);
  });

  it.each(refusals)('stop the server from starting at %j', (environment, message) => {
    expect(errorFrom(environment)).toBe(message);
  });
});
