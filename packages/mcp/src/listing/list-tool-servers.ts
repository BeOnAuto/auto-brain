import { BrainContext, InvalidInput, defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { serverNamePattern } from '../names/tool-reference.ts';
import { toolServersAsked, toolServersFound, type ToolServersAsked } from './tool-server-words.ts';
import { ToolServerSchema } from './tool-server.ts';

const description = [
  "Lists the tool servers this brain's functions may use, with the tools each offers, so a reasoning function names them in its tools as server/tool or server/*.",
  'Each server is asked for its tools when this is called, and one that cannot be asked just now says why in place of its tools.',
  'Use it before a reasoning function names a tool, or when the person asks which tools the brain can use; whoever runs the server sets the servers up.',
  '`server` lists the tools of one server alone.',
].join(' ');

const ListToolServersInputSchema = Schema.Struct({
  server: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Lists only the tool server of this name, as a function writes it before the slash',
    }).check(Schema.isPattern(serverNamePattern)),
  ),
});

const ToolServersSchema = Schema.Struct({
  tool_servers: Schema.Array(ToolServerSchema).annotate({
    description: 'The tool servers this brain may use, sorted by name; empty when none is set up for it',
  }),
});

function noServerNamed(server: string): InvalidInput {
  const detail = `This brain has no tool server named ${server}; call list_tool_servers without server to list the ones it has`;
  return new InvalidInput({ detail, issues: [{ detail, pointer: '/server' }] });
}

export function defineListToolServers(access: Pick<ToolAccess, 'listServers'>) {
  return defineQuery('brain', {
    name: 'list_tool_servers',
    title: 'List tool servers',
    description,
    route: { method: 'GET', path: '/tool-servers' },
    reachesOutside: true,
    inputSchema: ListToolServersInputSchema,
    outputSchema: ToolServersSchema,
    reasons: ['invalid_input'],
    handle: Effect.fnUntraced(function* ({ server }: ToolServersAsked) {
      const servers = yield* access.listServers(yield* BrainContext, server);
      if (server !== undefined && servers.length === 0) {
        return yield* noServerNamed(server);
      }
      return { tool_servers: servers };
    }),
    plainLanguage: {
      task: toolServersAsked({}),
      attempt: (asked) => toolServersAsked(asked),
      outcome: (answer) => toolServersFound(answer),
    },
  });
}
