import type { McpSession, ToolResult } from '@beonauto/api/testing';
import { serveFakeMcp } from '@beonauto/mcp/testing';
import type { ScriptedReply } from '@beonauto/reasoning/testing';

import type { ReasoningServer } from './reasoning-server.ts';
import { servingWorkflows } from './workflow-server.ts';

const toolServerKey = 'graph-api-key-4f1d9a7c2b';

type InBrain = (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;

export async function servingWithAToolServer(replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: toolServerKey });
  const server = await servingWorkflows(replies, {
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: toolServerKey,
    MCP_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'local' },
    }),
  });
  return {
    ...server,
    stop: async () => {
      await server.stop();
      await graph.close();
    },
  };
}

export async function toolTestsCalled(
  session: McpSession,
  inBrain: InBrain,
): Promise<readonly (readonly [string, ToolResult])[]> {
  const tested = await session.callTool(
    'test_tool_call',
    inBrain({ server: 'graph', tool: 'search', arguments: { query: 'acme' } }),
  );
  return [['test_tool_call', tested]];
}
