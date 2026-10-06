import type { Schema } from 'effect';

import type { ModelTools, ToolCallRequest, ToolCallSignals, ToolReply } from '../model/model-request.ts';

export interface ScriptedToolsOptions {
  readonly endAfter?: number;
  readonly runBoundMs?: number;
  readonly inputSchema?: Schema.JsonObject;
  readonly reply?: (request: ToolCallRequest, signals: ToolCallSignals, end: () => void) => Promise<ToolReply>;
}

export interface ScriptedTools {
  readonly tools: ModelTools;
  readonly calls: () => readonly ToolCallRequest[];
  readonly signals: () => readonly ToolCallSignals[];
}

export const searchTool = 'mcp__graph__search';

export const foundRows: ToolReply = { text: 'Found 2 rows.', isError: false };

export function scriptedTools({
  endAfter = 1,
  runBoundMs = 600_000,
  inputSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  reply = () => Promise.resolve(foundRows),
}: ScriptedToolsOptions = {}): ScriptedTools {
  const calls: ToolCallRequest[] = [];
  const signals: ToolCallSignals[] = [];
  const ending = new AbortController();
  const end = (): void => {
    ending.abort();
  };
  return {
    tools: {
      offered: [
        {
          name: searchTool,
          description: 'Finds the rows of the graph that match a query.',
          inputSchema,
          call: (request, given) => {
            calls.push(request);
            signals.push(given);
            return reply(request, given, end);
          },
        },
      ],
      callsEnded: () => calls.length >= endAfter,
      ended: ending.signal,
      runBoundMs,
    },
    calls: () => [...calls],
    signals: () => [...signals],
  };
}
