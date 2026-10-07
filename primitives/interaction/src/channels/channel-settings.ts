import { servesBrain, type ServedAddress, type ServedScope } from '@beonauto/config';
import type { ParsedTemplate } from '@beonauto/specs/template';
import type { Redacted } from 'effect';

interface ChannelBase {
  readonly name: string;
  readonly pattern: string;
  readonly allowsParty: (party: string) => boolean;
  readonly scope: ServedScope;
}

export interface WebhookChannel extends ChannelBase {
  readonly type: 'webhook';
  readonly url: string;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly secret: Redacted.Redacted;
  readonly answers: boolean;
}

export interface McpChannel extends ChannelBase {
  readonly type: 'mcp';
  readonly server: string;
  readonly tool: string;
  readonly with: ReadonlyMap<string, ParsedTemplate>;
}

export type Channel = WebhookChannel | McpChannel;

export interface ChannelSettings {
  readonly channels: ReadonlyMap<string, Channel>;
  readonly secrets: readonly Redacted.Redacted[];
}

export const noChannels: ChannelSettings = { channels: new Map(), secrets: [] };

export function channelFor(settings: ChannelSettings, name: string, address: ServedAddress): Channel | undefined {
  const channel = settings.channels.get(name);
  return channel !== undefined && servesBrain(channel.scope, address) ? channel : undefined;
}
