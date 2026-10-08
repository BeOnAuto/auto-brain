import { BrainIdSchema, Caller, OrgContext, canAccessBrain, defineQuery, type BrainAccess } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { everyBrain } from '../settings/mcp-settings.ts';
import { noServerNamed, serverField, toolServersSentences } from './list-tool-servers.ts';
import { orgToolServersAsked, orgToolServersFound, type OrgToolServersAsked } from './tool-server-words.ts';
import { OrgToolServerSchema, type OrgToolServer, type ToolServer } from './tool-server.ts';

const description = [
  ...toolServersSentences,
  'Without `brain` it answers for the whole org, naming the brains each server serves.',
].join(' ');

const ListToolServersInOrgInputSchema = Schema.Struct({
  brain: Schema.optionalKey(
    BrainIdSchema.annotate({
      description:
        'The id of a brain, to list only the tool servers its functions may use; without it, every tool server of the org is listed, each with the brains it serves',
    }),
  ),
  server: serverField,
});

const OrgToolServersSchema = Schema.Struct({
  tool_servers: Schema.Array(OrgToolServerSchema).annotate({
    description:
      'The tool servers of the org, or those of the brain asked for, sorted by name; empty when none is set up',
  }),
});

type ServedBrains = Pick<ToolAccess, 'brainsServedBy'>;

function brainsShownTo(access: BrainAccess, brains: readonly string[]): readonly string[] {
  return brains.filter((brain) => brain === everyBrain || canAccessBrain(access, brain));
}

function withServedBrains(server: ToolServer, served: ServedBrains, access: BrainAccess): OrgToolServer {
  return { ...server, brains: brainsShownTo(access, served.brainsServedBy(server.name)) };
}

export function defineListToolServersInOrg(tools: Pick<ToolAccess, 'listServers' | 'brainsServedBy'>) {
  return defineQuery('org', {
    name: 'list_tool_servers',
    title: 'List tool servers',
    description,
    route: { method: 'GET', path: '/tool-servers' },
    permittedBy: ['org:read', 'brain:read'],
    reachesOutside: true,
    inputSchema: ListToolServersInOrgInputSchema,
    outputSchema: OrgToolServersSchema,
    reasons: ['invalid_input'],
    handle: Effect.fnUntraced(function* ({ brain, server }: OrgToolServersAsked) {
      const { org } = yield* OrgContext;
      const { brains: access } = yield* Caller;
      const servers = yield* tools.listServers({ org, brain }, server);
      if (server !== undefined && servers.length === 0) {
        return yield* noServerNamed(server, brain === undefined ? 'This org' : 'This brain');
      }
      return { tool_servers: servers.map((listed) => withServedBrains(listed, tools, access)) };
    }),
    plainLanguage: {
      task: orgToolServersAsked({}),
      attempt: (asked) => orgToolServersAsked(asked),
      outcome: (answer, asked) => orgToolServersFound(answer, asked),
    },
  });
}
