import { BrainContext, InvalidInput, defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { serverNamePattern } from '../names/tool-reference.ts';
import { toolServersAsked, toolServersFound, type ToolServersAsked } from './tool-server-words.ts';
import { ToolServerSchema } from './tool-server.ts';

const description = [
  "Lists the tool servers this brain's functions may use, with the tools each offers, so a function can name them in `tools` as server/tool or server/*.",
  'Each server is asked for its tools when this is called, as a run asks it, with as long to connect and to list,',
  'unless the operator allows none of its tools, as then no run could reach it either;',
  'its tools are those the operator allows, each with its name, its description cut to 4 KiB and its input_schema.',
  'A server that cannot be asked just now has unavailable, saying why in words, in place of its tools.',
  '`server` lists only the server of that name, and asks no other; a name no server of this brain has is rejected with invalid_input.',
  'The runtime adds no header, environment value, URL, command or credential of a server to the answer;',
  'what a server writes is passed on with the values of its references to the environment and the tokens minted for it scrubbed out.',
].join(' ');

const ListToolServersInputSchema = Schema.Struct({
  server: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(serverNamePattern)).annotate({
      description: 'Lists only the tool server of this name, as a function writes it before the slash',
    }),
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
