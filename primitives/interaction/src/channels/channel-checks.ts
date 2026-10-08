import { liesWithin, pointerOf, problem, servedScopeOf, type ServedScope, type SettingProblem } from '@beonauto/config';
import { isDeliverableUrl, webhookSecretProblem } from '@beonauto/outbound';
import { Redacted, Result } from 'effect';

import { argumentTemplates, requestTemplates } from './argument-templates.ts';
import { channelsSetting, type ChannelEntry, type McpEntry, type WebhookEntry } from './channel-entries.ts';
import { inboxChannel, isChannelName } from './channel-names.ts';
import type { Channel, McpChannel, WebhookChannel } from './channel-settings.ts';

export interface OfferedServer {
  readonly name: string;
  readonly org: string;
  readonly brains: readonly string[] | null;
  readonly allowed: readonly string[] | null;
}

export interface ChannelContext {
  readonly servers: readonly OfferedServer[];
}

type Checked<A> = Result.Result<A, readonly SettingProblem[]>;

const headersSetByEveryDelivery: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  'host',
  'webhook-id',
  'webhook-timestamp',
  'webhook-signature',
]);

function at(name: string, ...path: readonly string[]): string {
  return pointerOf([name, ...path]);
}

function nameProblems(name: string): readonly SettingProblem[] {
  if (name === inboxChannel) {
    return [
      problem(
        channelsSetting,
        at(name),
        "Expected another name: inbox is the brain's own inbox, which no channel takes",
      ),
    ];
  }
  return isChannelName(name)
    ? []
    : [
        problem(
          channelsSetting,
          at(name),
          'Expected a channel name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
        ),
      ];
}

function partiesOf(name: string, written: string): Checked<(party: string) => boolean> {
  try {
    const pattern = new RegExp(`^(?:${written})$`, 'u');
    return Result.succeed((party) => pattern.test(party));
  } catch {
    return Result.fail([
      problem(channelsSetting, at(name, 'to'), 'Expected a regular expression the party must match'),
    ]);
  }
}

function webhookOf(
  name: string,
  entry: WebhookEntry,
  base: Omit<WebhookChannel, 'type' | 'url' | 'headers' | 'secret' | 'answers'>,
): Checked<WebhookChannel> {
  const headers = Object.entries(entry.headers ?? {});
  const problems = [
    ...(isDeliverableUrl(entry.url)
      ? []
      : [problem(channelsSetting, at(name, 'url'), 'Expected an https URL, or an http URL on a loopback address')]),
    ...[webhookSecretProblem(entry.secret)].flatMap((detail) =>
      detail === undefined ? [] : [problem(channelsSetting, at(name, 'secret'), detail)],
    ),
    ...headers
      .filter(([header]: readonly [string, string]) => headersSetByEveryDelivery.has(header.toLowerCase()))
      .map(([header]: readonly [string, string]) =>
        problem(
          channelsSetting,
          at(name, 'headers', header),
          `Expected no ${header} header, which every delivery sets`,
        ),
      ),
  ];
  return problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({
        ...base,
        type: 'webhook',
        url: entry.url,
        headers: new Map(headers.map(([header, value]: readonly [string, string]) => [header, Redacted.make(value)])),
        secret: Redacted.make(entry.secret),
        answers: entry.answers ?? false,
      });
}

function serverProblems(
  name: string,
  entry: McpEntry,
  scope: ServedScope,
  context: ChannelContext,
): readonly SettingProblem[] {
  const server = context.servers.find((offered) => offered.name === entry.server);
  if (server === undefined) {
    return [
      problem(channelsSetting, at(name, 'server'), `Expected an MCP server of mcp_servers; ${entry.server} is not one`),
    ];
  }
  return [
    ...(liesWithin(scope, server)
      ? []
      : [
          problem(
            channelsSetting,
            at(name),
            'Expected the org and brains of the channel to lie within those of its MCP server',
          ),
        ]),
    ...(server.allowed === null || server.allowed.includes(entry.tool)
      ? []
      : [
          problem(
            channelsSetting,
            at(name, 'tool'),
            `Expected a tool among the allowed of ${entry.server}; ${entry.tool} is not`,
          ),
        ]),
  ];
}

function mcpOf(
  name: string,
  entry: McpEntry,
  base: Omit<McpChannel, 'type' | 'server' | 'tool' | 'with'>,
  context: ChannelContext,
): Checked<McpChannel> {
  const problems = serverProblems(name, entry, base.scope, context);
  const templates = argumentTemplates([name, 'with'], entry.with, requestTemplates);
  if (problems.length > 0 || Result.isFailure(templates)) {
    return Result.fail([...problems, ...(Result.isFailure(templates) ? templates.failure : [])]);
  }
  return Result.succeed({ ...base, type: 'mcp', server: entry.server, tool: entry.tool, with: templates.success });
}

export function checkedChannel(name: string, entry: ChannelEntry, context: ChannelContext): Checked<Channel> {
  const naming = nameProblems(name);
  const parties = partiesOf(name, entry.to);
  const scope = servedScopeOf(channelsSetting, name, entry, 'channel');
  if (naming.length > 0 || Result.isFailure(parties) || Result.isFailure(scope)) {
    return Result.fail([
      ...naming,
      ...(Result.isFailure(parties) ? parties.failure : []),
      ...(Result.isFailure(scope) ? scope.failure : []),
    ]);
  }
  const base = { name, pattern: entry.to, allowsParty: parties.success, scope: scope.success };
  return entry.type === 'webhook' ? webhookOf(name, entry, base) : mcpOf(name, entry, base, context);
}
