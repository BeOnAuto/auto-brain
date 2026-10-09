import { Client } from '@modelcontextprotocol/client';
import { Predicate } from 'effect';

import { decodeListedTools, decodeToolResult, type ListedTool, type ToolResult } from '../bounds/tool-results.ts';
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

export interface OutputReport {
  readonly scrub: (text: string) => string;
  readonly report: (line: string) => void;
}

const mostReportedLines = 100;

const mostReportedCharacters = 2000;

export const errorsNoLongerReported = 'The MCP server caused more errors than are reported; the rest is not shown';

export function boundedReport({ scrub, report }: OutputReport, noLongerReported: string): (line: string) => void {
  let reported = 0;
  return (line) => {
    reported += 1;
    if (reported <= mostReportedLines) {
      report(scrub(line).slice(0, mostReportedCharacters));
    }
    if (reported === mostReportedLines + 1) {
      report(noLongerReported);
    }
  };
}

const metaField = '_meta';

const clientInfo = { name: 'auto-brain', version: '1.0.0' };

export function openingClient(requestIdHeader: string | null, reportError: (message: string) => void): OpenedClient {
  const client = new Client(clientInfo, { capabilities: {} });
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  Object.assign(client, {
    onclose: resolve,
    onerror: ({ message }: Readonly<Error>) => {
      reportError(message);
    },
  });
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

function contentJsonOf(answer: unknown): string {
  const content: unknown = Reflect.get(new Object(answer), 'content');
  const structuredContent: unknown = Reflect.get(new Object(answer), 'structuredContent');
  return JSON.stringify(structuredContent === undefined ? { content } : { content, structuredContent });
}

function settledOf(answer: unknown): { readonly result: ToolResult; readonly resultJson: string } {
  return { result: decodeToolResult(answer), resultJson: contentJsonOf(answer) };
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
