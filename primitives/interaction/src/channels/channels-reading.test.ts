import { Effect, Redacted, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { partnerSecret } from '../testing/index.ts';
import type { ChannelContext } from './channel-checks.ts';
import { channelFor, noChannels } from './channel-settings.ts';
import { readChannelSettings } from './channels-reading.ts';

const slack = { name: 'slack', org: 'acme', brains: null, allowed: null };

const context: ChannelContext = { servers: [slack] };

const environment = {
  PARTNER_API_KEY: 'partner-api-key-7f3a9c',
  PARTNER_WEBHOOK_SECRET: partnerSecret,
  PARTNER_SHORT_SECRET: 'whsec_c2hvcnQ=',
};

const partner = {
  type: 'webhook',
  url: 'https://partner.example.com/brain/requests',
  headers: { Authorization: 'Bearer ${PARTNER_API_KEY}' },
  secret: '${PARTNER_WEBHOOK_SECRET}',
  to: '^[a-z]+@partner\\.example\\.com$',
  answers: true,
  org: 'acme',
  brains: ['sales'],
} as const;

const approvals = {
  type: 'mcp',
  server: 'slack',
  tool: 'post_message',
  to: '^#approvals-[a-z-]+$',
  with: { channel: '{{ to }}', text: '{{ message }}', schema: '{{ answer_schema | json }}' },
  org: 'acme',
};

function read(channels: unknown, given: ChannelContext = context) {
  return Effect.runSync(
    Effect.result(readChannelSettings({ ...environment, CHANNELS: JSON.stringify(channels) }, given)),
  );
}

function templated(template: string) {
  return { approvals: { ...approvals, with: { text: template } } };
}

const tooManyNames: unknown = expect.stringContaining('A template may use at most 1000 names');

function problemsOf(channels: unknown, given: ChannelContext = context): readonly string[] {
  const outcome = read(channels, given);
  return Result.isFailure(outcome) ? outcome.failure.problems.map(({ detail }) => detail) : [];
}

describe('the channels of a server', () => {
  it('read a webhook and an MCP channel, keeping their secrets for scrubbing', () => {
    const settings = Effect.runSync(
      readChannelSettings({ ...environment, CHANNELS: JSON.stringify({ partner, approvals }) }, context),
    );
    const webhook = settings.channels.get('partner');

    expect(webhook).toMatchObject({ type: 'webhook', answers: true, scope: { org: 'acme', brains: ['sales'] } });
    expect(settings.secrets.map((secret) => Redacted.value(secret))).toEqual(['partner-api-key-7f3a9c', partnerSecret]);
    expect([
      webhook?.allowsParty('ada@partner.example.com'),
      webhook?.allowsParty('ada@partner.example.com.evil'),
    ]).toEqual([true, false]);
    expect(settings.channels.get('approvals')).toMatchObject({ type: 'mcp', server: 'slack', tool: 'post_message' });
  });

  it('are none when the setting is left out, and serve the brains they name alone', () => {
    const settings = Effect.runSync(
      readChannelSettings({ ...environment, CHANNELS: JSON.stringify({ partner }) }, context),
    );

    expect([
      Effect.runSync(readChannelSettings({}, context)),
      Effect.runSync(readChannelSettings({ CHANNELS: ' ' }, context)),
      channelFor(settings, 'partner', { org: 'acme', brain: 'sales' })?.name,
      channelFor(settings, 'partner', { org: 'acme', brain: 'support' }),
      channelFor(settings, 'gone', { org: 'acme', brain: 'sales' }),
    ]).toEqual([noChannels, noChannels, 'partner', undefined, undefined]);
  });
});

describe('a channel the server refuses at start', () => {
  it.each([
    [
      'inbox',
      { inbox: partner },
      "/inbox: Expected another name: inbox is the brain's own inbox, which no channel takes",
    ],
    [
      'a name that is not one',
      { Partner: partner },
      '/Partner: Expected a channel name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
    ],
    [
      'a party pattern',
      { partner: { ...partner, to: '([' } },
      '/partner/to: Expected a regular expression the party must match',
    ],
    [
      'plain HTTP to another machine',
      { partner: { ...partner, url: 'http://partner.example.com/requests' } },
      '/partner/url: Expected an https URL, or an http URL on a loopback address',
    ],
    [
      'a header every delivery sets',
      { partner: { ...partner, headers: { 'Webhook-Signature': 'x' } } },
      '/partner/headers/Webhook-Signature: Expected no Webhook-Signature header, which every delivery sets',
    ],
    ['a missing org', { partner: { ...partner, org: undefined } }, '/partner: Expected the org this channel serves'],
  ] as const)('refuses %s', (_case, channels, problem) => {
    expect(problemsOf(channels)).toEqual([problem]);
  });
});

describe('the secrets and the size of the channels', () => {
  it('refuses a secret that is not one, a reference outside headers and secret, and a credential written out', () => {
    expect([
      problemsOf({ partner: { ...partner, secret: '${PARTNER_SHORT_SECRET}' } }),
      problemsOf({ partner: { ...partner, secret: partnerSecret } }),
      problemsOf({ partner: { ...partner, url: 'https://${PARTNER_API_KEY}.example.com/' } }),
      problemsOf({ partner: { ...partner, secret: '${PARTNER_MISSING}' } }),
    ]).toEqual([
      ['/partner/secret: Expected a key of 24 to 64 bytes after whsec_, not 5'],
      [
        '/partner/secret: Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${PARTNER_API_KEY}',
      ],
      [
        '/partner/url: Holds a reference to an environment variable, which only headers and secret may hold, so a secret never reaches a template or a URL',
      ],
      [expect.stringContaining('PARTNER_MISSING')],
    ]);
  });

  it('refuses more than 32 channels, and an entry that is neither a webhook nor an MCP channel', () => {
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`partner-${index}`, partner]));

    expect([problemsOf(many), problemsOf({ partner: { type: 'email', to: 'x' } }).length > 0]).toEqual([
      ['/: Expected at most 32 channels, not 33'],
      true,
    ]);
  });
});

describe('an MCP channel the server refuses at start', () => {
  it('refuses a server that is not configured, a channel wider than its server, and a tool its server does not allow', () => {
    const teams = { name: 'teams', org: 'acme', brains: null, allowed: ['post_message'] };

    expect([
      problemsOf({ approvals: { ...approvals, server: 'teams' } }),
      problemsOf({ approvals }, { servers: [{ ...slack, brains: ['sales'] }] }),
      problemsOf({ approvals }, { servers: [{ ...slack, allowed: ['search'] }, teams] }),
      problemsOf({ approvals }, { servers: [{ ...slack, allowed: ['search', 'post_message'] }] }),
      problemsOf({ approvals }, { servers: [slack] }),
    ]).toEqual([
      ['/approvals/server: Expected an MCP server of mcp_servers; teams is not one'],
      ['/approvals: Expected the org and brains of the channel to lie within those of its MCP server'],
      ['/approvals/tool: Expected a tool among the allowed of slack; post_message is not'],
      [],
      [],
    ]);
  });

  it('refuses a template that holds ${, does not compile, reads what a request does not have, or renders no text', () => {
    expect([
      problemsOf(templated('$${HOME}')),
      problemsOf(templated('{{ message')),
      problemsOf(templated('{{ secret }}')),
      problemsOf(templated('{{ answer_schema }}')),
      problemsOf(templated('{{ answer_schema.required }}')),
    ]).toEqual([
      ['/approvals/with/text: Expected no ${ in a template, which never holds a secret; write $$ for a $'],
      [expect.stringContaining('/approvals/with/text: ')],
      [
        '/approvals/with/text: Reads secret, which a template of a channel does not have; it reads to, message, run_id, function, expires_at and answer_schema',
      ],
      [
        '/approvals/with/text: Renders a value that is not text; write | json after a structured value such as answer_schema',
      ],
      [],
    ]);
  });
});

describe('a channel written with the least it takes', () => {
  it('sends no headers and takes no answer within its deliveries, and refuses a template of more than 1,000 names', () => {
    const plain = {
      type: 'webhook',
      url: partner.url,
      secret: '${PARTNER_WEBHOOK_SECRET}',
      to: '^[a-z]+$',
      org: 'acme',
    };
    const settings = Effect.runSync(
      readChannelSettings({ ...environment, CHANNELS: JSON.stringify({ plain }) }, context),
    );

    expect(settings.channels.get('plain')).toMatchObject({ headers: new Map(), answers: false });
    expect(problemsOf({ approvals: { ...approvals, with: { text: '{{ to }}'.repeat(1001) } } })).toEqual([
      tooManyNames,
    ]);
  });
});
