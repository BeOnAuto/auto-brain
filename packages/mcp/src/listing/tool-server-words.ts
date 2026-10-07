import { counted, listed, plainNumber, quoted, type Noun } from '@beonauto/operations';

import { inWords } from '../names/tool-words.ts';
import type { ServerTool, ToolServer } from './tool-server.ts';

export interface ToolServersAsked {
  readonly server?: string;
}

export interface ToolServers {
  readonly tool_servers: readonly ToolServer[];
}

const serverNoun: Noun = { one: 'tool server', other: 'tool servers' };

const toolNoun: Noun = { one: 'tool', other: 'tools' };

const mostNamedTools = 20;

function namesOf(tools: readonly ServerTool[]): string {
  const named = tools.slice(0, mostNamedTools).map(({ name }) => inWords(name));
  const others = tools.length - named.length;
  return listed(others === 0 ? named : [...named, `${plainNumber(others)} more`]);
}

function serverInWords(server: ToolServer): string {
  const name = quoted(server.name);
  if ('unavailable' in server) {
    return `${name} could not be asked for its tools just now.`;
  }
  return server.tools.length === 0
    ? `${name} offers no tool this brain may use.`
    : `${name} offers ${counted(server.tools.length, toolNoun)}: ${namesOf(server.tools)}.`;
}

function noServerFor({ server }: ToolServersAsked): string {
  return server === undefined
    ? 'Whoever runs this server has set up no tool server for this brain, so its functions can call no tools.'
    : `Whoever runs this server has set up no tool server named ${quoted(server)} for this brain.`;
}

export function toolServersAsked({ server }: ToolServersAsked): string {
  return server === undefined
    ? "list the tool servers this brain's functions may use"
    : `list the tools of the tool server ${quoted(server)}`;
}

export function toolServersFound({ tool_servers: servers }: ToolServers, asked: ToolServersAsked): string {
  if (servers.length === 0) {
    return noServerFor(asked);
  }
  const opening = `This brain's functions may use ${counted(servers.length, serverNoun)}.`;
  return [opening, ...servers.map((server) => serverInWords(server))].join(' ');
}
