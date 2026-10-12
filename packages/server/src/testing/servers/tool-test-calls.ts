import type { McpSession, ToolResult } from '@on.auto/api/testing';
import { serveFakeMcp } from '@on.auto/mcp/testing';
import type { ScriptedReply } from '@on.auto/reasoning/testing';

import type { ReasoningServer } from './reasoning-server.ts';
import { servingWorkflows } from './workflow-server.ts';

const toolServerKey = 'graph-api-key-4f1d9a7c2b';

type InPlaybook = (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;

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
  inPlaybook: InPlaybook,
): Promise<readonly (readonly [string, ToolResult])[]> {
  const tested = await session.callTool(
    'test_tool_call',
    inPlaybook({ server: 'graph', tool: 'search', arguments: { query: 'acme' } }),
  );
  return [['test_tool_call', tested]];
}
