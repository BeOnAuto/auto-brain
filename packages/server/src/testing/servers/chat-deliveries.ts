import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import type { InteractionServer } from './interaction-server.ts';
import { alpha } from './reasoning-server.ts';

export const chatKey = 'chat-api-key-5a1c9e27';

export async function chatServer(): Promise<FakeMcpServer> {
  const chat = await serveFakeMcp({ bearer: chatKey, chat: true });
  onTestFinished(chat.close);
  return chat;
}

export function chatEnvironment(
  url: string,
  entry: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, string>> {
  return {
    CHAT_KEY: chatKey,
    MCP_SERVERS: JSON.stringify({
      chat: { url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'acme', ...entry },
    }),
  };
}

const HistorySchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Record(Schema.String, Schema.Unknown) })),
});

const decodeHistory = Schema.decodeUnknownSync(HistorySchema);

export async function deliveryHistoryOf(
  server: InteractionServer,
  runId: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const history = await server.call('GET', `${alpha}/executions/${runId}/history`);
  return decodeHistory(history.body)
    .events.filter(({ type }) => type === 'delivery_started' || type === 'delivery_ended')
    .map(({ type, data }) => Object.assign({ type }, data));
}
