import { Client } from '@modelcontextprotocol/client';
import { Predicate } from 'effect';

import { decodeListedTools, decodeToolResult, type ListedTool, type ToolResult } from '../bounds/result-text.ts';
import { observations, type Observed, type Observations } from './observed-requests.ts';

interface ToolCalling {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly signal: Readonly<AbortSignal>;
  readonly timeoutMs: number;
}

export type CallSettled =
  | { readonly result: ToolResult; readonly resultJson: string; readonly observed: Observed }
  | { readonly error: unknown; readonly observed: Observed };

export interface McpConnection {
  readonly call: (calling: ToolCalling) => Promise<CallSettled>;
  readonly listTools: (timeoutMs: number) => Promise<readonly ListedTool[]>;
  readonly closed: Promise<void>;
  readonly end: () => Promise<void>;
}

interface ToolClient {
  readonly callTool: Client['callTool'];
  readonly listTools: Client['listTools'];
}

export interface OpenedClient {
  readonly client: Client;
  readonly observations: Observations;
  readonly closed: Promise<void>;
}

const metaField = '_meta';

const clientInfo = { name: 'auto-brain', version: '1.0.0' };

export function openingClient(requestIdHeader: string | null): OpenedClient {
  const client = new Client(clientInfo, { capabilities: {} });
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  Object.assign(client, { onclose: resolve });
  return { client, observations: observations(requestIdHeader), closed };
}

export function observingFetch<Args extends readonly [unknown, unknown?]>(
  fetch: (...args: Args) => Promise<Response>,
  observed: Observations,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const response = await fetch(...args);
    const [, init] = args;
    observed.noteAnswered(Predicate.hasProperty(init, 'body') ? init.body : undefined, response);
    return response;
  };
}

function settledOf(answer: unknown): { readonly result: ToolResult; readonly resultJson: string } {
  return { result: decodeToolResult(answer), resultJson: JSON.stringify(answer) };
}

export function connectionOver(
  client: ToolClient,
  observed: Observations,
  closed: Promise<void>,
  end: () => Promise<void>,
): McpConnection {
  return {
    call: async ({ tool, input, meta, signal, timeoutMs }) => {
      const marker = observed.mark();
      const settled = await client
        .callTool(
          { name: tool, arguments: { ...input }, [metaField]: { ...meta } },
          { signal, timeout: timeoutMs, onresumptiontoken: marker },
        )
        .then(settledOf, (error: unknown) => ({ error }));
      return { ...settled, observed: observed.take(marker) };
    },
    listTools: async (timeoutMs) => {
      const listing: unknown = await client.listTools(undefined, { timeout: timeoutMs, cacheMode: 'refresh' });
      return decodeListedTools(listing).tools;
    },
    closed,
    end,
  };
}
