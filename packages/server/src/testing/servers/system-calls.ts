import { callDocument, type CallOptions } from '@beonauto/interaction/testing';
import type { Timing } from '@beonauto/mcp';
import { serveFakeMcp, type FakeHints, type FakeMcpServer } from '@beonauto/mcp/testing';
import { Schema } from 'effect';
import { expect, onTestFinished } from 'vitest';

import { chatKey } from './chat-deliveries.ts';
import type { TestResponse } from './http-client.ts';
import { interactionServerOn, type InteractionServer } from './interaction-server.ts';
import { alpha } from './reasoning-server.ts';

export const threadInput = { channel: 'C0123', thread: '1728379900.000050' };

export const systemRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const anyOutput: readonly string[] = ['output:', '  schema: {}'];

export const openInput: readonly string[] = ['input:', '  schema: { type: object }'];

export function calling(tool: string, written: readonly string[] = []): CallOptions {
  return { tool, read: null, with: written, input: openInput, output: anyOutput };
}

export function problemWith(fields: Readonly<Record<string, unknown>>): unknown {
  return expect.objectContaining(fields);
}

export interface SystemOptions {
  readonly hints?: FakeHints;
  readonly entry?: Readonly<Record<string, unknown>>;
  readonly servers?: Readonly<Record<string, unknown>>;
  readonly timing?: Timing;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface SystemServer extends InteractionServer {
  readonly fake: FakeMcpServer;
  readonly define: (name: string, document?: CallOptions) => Promise<TestResponse>;
  readonly runCall: (name: string, input?: unknown, runId?: string) => Promise<TestResponse>;
  readonly history: (runId: string) => Promise<readonly HistoryEvent[]>;
}

const HistorySchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Record(Schema.String, Schema.Unknown) }),
  ),
});

export type HistoryEvent = (typeof HistorySchema.Type)['events'][number];

const decodeHistory = Schema.decodeUnknownSync(HistorySchema);

export async function askingASystem({
  hints = {},
  entry = {},
  servers = {},
  timing,
  environment = {},
}: SystemOptions = {}): Promise<SystemServer> {
  const fake = await serveFakeMcp({ bearer: chatKey, data: true, hints });
  onTestFinished(fake.close);
  const chat = { url: fake.url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'acme', ...entry };
  const server = await interactionServerOn(
    { CHAT_KEY: chatKey, MCP_SERVERS: JSON.stringify({ chat, ...servers }), ...environment },
    timing === undefined ? {} : { toolTiming: timing },
  );
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  return {
    ...server,
    fake,
    define: (name, document = {}) =>
      server.call('POST', `${alpha}/definitions/interaction`, { body: { name, source: callDocument(document) } }),
    runCall: (name, input = threadInput, runId = systemRunId) =>
      server.call('POST', `${alpha}/definitions/interaction/${name}/run`, { body: { input, run_id: runId } }),
    history: async (runId) => decodeHistory((await server.call('GET', `${alpha}/runs/${runId}/history`)).body).events,
  };
}
