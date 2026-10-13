import {
  Caller,
  OrgContext,
  canAccessPlaybook,
  defineQuery,
  type NotFound,
  type OrgReader,
  type PlaybookAccess,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { everyPlaybook } from '../settings/server-settings.ts';
import { foundIn } from './found-tools.ts';
import { OrgFoundSchema, OrgSearchInputSchema, type OrgSearchedServer, type SearchedServer } from './search-schemas.ts';
import { orgSearchAttempted, orgSearched, searchTask } from './search-words.ts';
import { noServerNamed, searchSentences } from './search.ts';

const description = [
  ...searchSentences,
  'Without `playbook` it searches the tool servers of the whole org, naming the playbooks each serves.',
].join(' ');

export type PlaybookLookup = (playbook: string) => Effect.Effect<unknown, NotFound, OrgReader>;

type ServedPlaybooks = Pick<ToolAccess, 'playbooksServedBy'>;

function playbooksShownTo(access: PlaybookAccess, playbooks: readonly string[]): readonly string[] {
  return playbooks.filter((playbook) => playbook === everyPlaybook || canAccessPlaybook(access, playbook));
}

function withServedPlaybooks(
  server: SearchedServer,
  served: ServedPlaybooks,
  access: PlaybookAccess,
): OrgSearchedServer {
  return { ...server, playbooks: playbooksShownTo(access, served.playbooksServedBy(server.name)) };
}

export function defineSearchInOrg(
  tools: Pick<ToolAccess, 'listServers' | 'playbooksServedBy'>,
  lookUpPlaybook: PlaybookLookup,
) {
  return defineQuery('org', {
    name: 'search',
    title: 'Search tools',
    description,
    route: { method: 'GET', path: '/tool-servers/search' },
    permittedBy: ['org:read', 'playbook:read'],
    reachesOutside: true,
    inputSchema: OrgSearchInputSchema,
    outputSchema: OrgFoundSchema,
    reasons: ['invalid_input', 'not_found'],
    handle: Effect.fnUntraced(function* (asked) {
      const { playbook, server } = asked;
      if (playbook !== undefined) {
        yield* lookUpPlaybook(playbook);
      }
      const { org } = yield* OrgContext;
      const { playbooks: access } = yield* Caller;
      const servers = yield* tools.listServers({ org, playbook }, server);
      if (server !== undefined && servers.length === 0) {
        return yield* noServerNamed(server, playbook === undefined ? 'This org' : 'This playbook');
      }
      const found = foundIn(servers, asked);
      return { ...found, servers: found.servers.map((searched) => withServedPlaybooks(searched, tools, access)) };
    }),
    plainLanguage: {
      task: searchTask,
      attempt: (asked) => orgSearchAttempted(asked),
      outcome: (answer, asked) => orgSearched(answer, asked),
    },
  });
}
