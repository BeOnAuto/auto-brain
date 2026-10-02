import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as PreviousMajorClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as PreviousMajorTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Schema } from 'effect';

export type McpClientKind = 'current revision' | 'previous revision' | 'previous major';

export const mcpClientKinds: readonly McpClientKind[] = ['current revision', 'previous revision', 'previous major'];

export const expectedProtocolVersion: Readonly<Record<McpClientKind, string>> = {
  'current revision': '2026-07-28',
  'previous revision': '2025-11-25',
  'previous major': '2025-11-25',
};

export interface McpConnection {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface McpSession {
  readonly protocolVersion: string | undefined;
  readonly serverVersion: unknown;
  readonly instructions: string | undefined;
  readonly listTools: () => Promise<unknown>;
  readonly callTool: (name: string, input?: Readonly<Record<string, unknown>>) => Promise<ToolResult>;
  readonly close: () => Promise<void>;
}

const ToolResultSchema = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  content: Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
  structuredContent: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type ToolResult = typeof ToolResultSchema.Type;

const toolResultOf = Schema.decodeUnknownSync(ToolResultSchema);

export function textOf({ content }: ToolResult): string {
  return content.map(({ text }) => text).join('');
}

export function plainTextIn({ content }: ToolResult): string {
  return content
    .slice(0, 1)
    .map(({ text }) => text)
    .join('');
}

export function technicalTextIn({ content }: ToolResult): string {
  return content
    .slice(-1)
    .map(({ text }) => text)
    .join('');
}

export function problemIn(result: ToolResult): unknown {
  const parsed: unknown = JSON.parse(technicalTextIn(result));
  return parsed;
}

function argumentsOf(input: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
  return input === undefined ? undefined : { ...input };
}

class PreviousMajorHttpTransport implements Transport {
  onclose?: NonNullable<Transport['onclose']>;
  onerror?: NonNullable<Transport['onerror']>;
  onmessage?: NonNullable<Transport['onmessage']>;
  readonly send: Transport['send'];
  readonly close: Transport['close'];
  readonly setProtocolVersion: NonNullable<Transport['setProtocolVersion']>;
  readonly #inner: PreviousMajorTransport;

  constructor({ url, headers }: McpConnection) {
    this.#inner = new PreviousMajorTransport(new URL(url), { requestInit: { headers: { ...headers } } });
    this.send = this.#inner.send.bind(this.#inner);
    this.close = this.#inner.close.bind(this.#inner);
    this.setProtocolVersion = (version) => {
      this.#inner.setProtocolVersion(version);
    };
  }

  get protocolVersion(): string | undefined {
    return this.#inner.protocolVersion;
  }

  async start(): Promise<void> {
    Object.assign(this.#inner, { onclose: this.onclose, onerror: this.onerror, onmessage: this.onmessage });
    await this.#inner.start();
  }
}

async function connectPreviousMajor(connection: McpConnection): Promise<McpSession> {
  const client = new PreviousMajorClient({ name: 'auto-brain-tests', version: '1.0.0' });
  const transport = new PreviousMajorHttpTransport(connection);
  await client.connect(transport);
  return {
    protocolVersion: transport.protocolVersion,
    serverVersion: client.getServerVersion(),
    instructions: client.getInstructions(),
    listTools: () => client.listTools(),
    callTool: async (name, input) => toolResultOf(await client.callTool({ name, arguments: argumentsOf(input) })),
    close: () => client.close(),
  };
}

async function connectCurrentMajor(kind: McpClientKind, { url, headers }: McpConnection): Promise<McpSession> {
  const versionNegotiation = kind === 'current revision' ? { mode: { pin: '2026-07-28' } } : {};
  const client = new Client({ name: 'auto-brain-tests', version: '2.0.0' }, { versionNegotiation });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { ...headers } } }));
  return {
    protocolVersion: client.getNegotiatedProtocolVersion(),
    serverVersion: client.getServerVersion(),
    instructions: client.getInstructions(),
    listTools: () => client.listTools(),
    callTool: async (name, input) => toolResultOf(await client.callTool({ name, arguments: argumentsOf(input) })),
    close: () => client.close(),
  };
}

export function connectMcp(kind: McpClientKind, connection: McpConnection): Promise<McpSession> {
  return kind === 'previous major' ? connectPreviousMajor(connection) : connectCurrentMajor(kind, connection);
}

export async function withMcpSession<T>(
  kind: McpClientKind,
  connection: McpConnection,
  use: (session: McpSession) => Promise<T>,
): Promise<T> {
  const session = await connectMcp(kind, connection);
  try {
    return await use(session);
  } finally {
    await session.close();
  }
}
