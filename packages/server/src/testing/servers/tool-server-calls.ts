import type { McpSession, ToolResult } from '@on.auto/api/testing';
import type { ScriptedReply } from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/testing';

import type { ReasoningServer } from './reasoning-server.ts';
import { servingWorkflows } from './workflow-server.ts';

const toolServerKey = 'graph-api-key-4f1d9a7c2b';

type InPlaybook = (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;

export async function servingWithAToolServer(replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: toolServerKey });
  const server = await servingWorkflows(replies, {
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: toolServerKey,
    TOOL_SERVERS: JSON.stringify({
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

export async function toolServerToolsCalled(
  session: McpSession,
  inPlaybook: InPlaybook,
): Promise<readonly (readonly [string, ToolResult])[]> {
  const asked = { server: 'graph', tool: 'search' };
  const searchedFor = { ...asked, arguments: { query: 'acme' } };
  return [
    ['search', await session.callTool('search', inPlaybook({ terms: 'rows' }))],
    ['introspect', await session.callTool('introspect', inPlaybook(asked))],
    ['validate', await session.callTool('validate', inPlaybook(searchedFor))],
    ['dry_run', await session.callTool('dry_run', inPlaybook(searchedFor))],
    ['execute', await session.callTool('execute', inPlaybook(searchedFor))],
  ];
}
