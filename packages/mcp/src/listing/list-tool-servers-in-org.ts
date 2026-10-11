import {
  PlaybookIdSchema,
  Caller,
  OrgContext,
  canAccessPlaybook,
  defineQuery,
  type PlaybookAccess,
  type NotFound,
  type OrgReader,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { everyPlaybook } from '../settings/mcp-settings.ts';
import { noServerNamed, serverField, toolServersSentences } from './list-tool-servers.ts';
import { orgToolServersAsked, orgToolServersFound, type OrgToolServersAsked } from './tool-server-words.ts';
import { OrgToolServerSchema, type OrgToolServer, type ToolServer } from './tool-server.ts';

const description = [
  ...toolServersSentences,
  'Without `playbook` it answers for the whole org, naming the playbooks each server serves.',
].join(' ');

const ListToolServersInOrgInputSchema = Schema.Struct({
  playbook: Schema.optionalKey(
    PlaybookIdSchema.annotate({
      description:
        'The id of a playbook, to list only the tool servers its functions may use; without it, every tool server of the org is listed, each with the playbooks it serves',
    }),
  ),
  server: serverField,
});

const OrgToolServersSchema = Schema.Struct({
  tool_servers: Schema.Array(OrgToolServerSchema).annotate({
    description:
      'The tool servers of the org, or those of the playbook asked for, sorted by name; empty when none is set up',
  }),
});

type ServedPlaybooks = Pick<ToolAccess, 'playbooksServedBy'>;

export type PlaybookLookup = (playbook: string) => Effect.Effect<unknown, NotFound, OrgReader>;

function playbooksShownTo(access: PlaybookAccess, playbooks: readonly string[]): readonly string[] {
  return playbooks.filter((playbook) => playbook === everyPlaybook || canAccessPlaybook(access, playbook));
}

function withServedPlaybooks(server: ToolServer, served: ServedPlaybooks, access: PlaybookAccess): OrgToolServer {
  return { ...server, playbooks: playbooksShownTo(access, served.playbooksServedBy(server.name)) };
}

export function defineListToolServersInOrg(
  tools: Pick<ToolAccess, 'listServers' | 'playbooksServedBy'>,
  lookUpPlaybook: PlaybookLookup,
) {
  return defineQuery('org', {
    name: 'list_tool_servers',
    title: 'List tool servers',
    description,
    route: { method: 'GET', path: '/tool-servers' },
    permittedBy: ['org:read', 'playbook:read'],
    reachesOutside: true,
    inputSchema: ListToolServersInOrgInputSchema,
    outputSchema: OrgToolServersSchema,
    reasons: ['invalid_input', 'not_found'],
    handle: Effect.fnUntraced(function* ({ playbook, server }: OrgToolServersAsked) {
      if (playbook !== undefined) {
        yield* lookUpPlaybook(playbook);
      }
      const { org } = yield* OrgContext;
      const { playbooks: access } = yield* Caller;
      const servers = yield* tools.listServers({ org, playbook }, server);
      if (server !== undefined && servers.length === 0) {
        return yield* noServerNamed(server, playbook === undefined ? 'This org' : 'This playbook');
      }
      return { tool_servers: servers.map((listed) => withServedPlaybooks(listed, tools, access)) };
    }),
    plainLanguage: {
      task: orgToolServersAsked({}),
      attempt: (asked) => orgToolServersAsked(asked),
      outcome: (answer, asked) => orgToolServersFound(answer, asked),
    },
  });
}
