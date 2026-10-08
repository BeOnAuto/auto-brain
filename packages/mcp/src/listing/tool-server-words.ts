import { counted, listed, plainNumber, quoted, type Noun } from '@beonauto/operations';

import { inWords } from '../names/tool-words.ts';
import { everyBrain } from '../settings/mcp-settings.ts';
import type { OrgToolServer, ServerTool, ToolServer } from './tool-server.ts';

export interface ToolServersAsked {
  readonly server?: string;
}

export interface OrgToolServersAsked extends ToolServersAsked {
  readonly brain?: string;
}

export interface ToolServers {
  readonly tool_servers: readonly ToolServer[];
}

export interface OrgToolServers {
  readonly tool_servers: readonly OrgToolServer[];
}

interface Speaking {
  readonly named: string;
  readonly user: string;
}

const serverNoun: Noun = { one: 'tool server', other: 'tool servers' };

const toolNoun: Noun = { one: 'tool', other: 'tools' };

const mostNamedTools = 20;

function namesOf(tools: readonly ServerTool[]): string {
  const named = tools.slice(0, mostNamedTools).map(({ name }) => inWords(name));
  const others = tools.length - named.length;
  return listed(others === 0 ? named : [...named, `${plainNumber(others)} more`]);
}

function testableAmong(tools: readonly ServerTool[]): string {
  const testable = tools.filter(({ testable: canBe }) => canBe);
  return testable.length === 0 ? 'none can be tested' : `${namesOf(testable)} can be tested`;
}

function serverInWords(server: ToolServer, { named, user }: Speaking): string {
  if ('unavailable' in server) {
    return server.because === 'key_refused'
      ? `${named} did not accept the key this server gives it, so whoever runs this server can check that key.`
      : `${named} could not be asked for its tools just now.`;
  }
  return server.tools.length === 0
    ? `${named} offers no tool ${user} may use.`
    : `${named} offers ${counted(server.tools.length, toolNoun)}: ${namesOf(server.tools)}; ${testableAmong(server.tools)}.`;
}

function brainsInWords(brains: readonly string[]): string {
  if (brains.includes(everyBrain)) {
    return 'every brain';
  }
  const named = listed(brains.map((brain) => quoted(brain)));
  return brains.length === 0 ? 'no brain' : `${brains.length === 1 ? 'the brain' : 'the brains'} ${named}`;
}

const noServer =
  'Whoever runs this server has set up no tool server for this brain, so its functions can call no tools until they set one up; the give-tools guide says what they need.';

const noServerInOrg =
  'Whoever runs this server has set up no tool server for this org, so the functions of its brains can call no tools until they set one up; the give-tools guide says what they need.';

export function toolServersAsked({ server }: ToolServersAsked): string {
  return server === undefined
    ? "list the tool servers this brain's functions may use"
    : `list the tools of the tool server ${quoted(server)}`;
}

export function toolServersFound({ tool_servers: servers }: ToolServers): string {
  if (servers.length === 0) {
    return noServer;
  }
  const opening = `This brain's functions may use ${counted(servers.length, serverNoun)}.`;
  return [
    opening,
    ...servers.map((server) => serverInWords(server, { named: quoted(server.name), user: 'this brain' })),
  ].join(' ');
}

export function orgToolServersAsked(asked: OrgToolServersAsked): string {
  return asked.brain === undefined && asked.server === undefined
    ? 'list the tool servers the brains of this org may use'
    : toolServersAsked(asked);
}

function orgServerInWords(server: OrgToolServer): string {
  const named = `${quoted(server.name)}, for ${brainsInWords(server.brains)},`;
  return serverInWords(server, { named, user: 'a function' });
}

export function orgToolServersFound(answer: OrgToolServers, { brain }: OrgToolServersAsked): string {
  const servers = answer.tool_servers;
  if (brain !== undefined) {
    return toolServersFound(answer);
  }
  if (servers.length === 0) {
    return noServerInOrg;
  }
  const opening = `The brains of this org may use ${counted(servers.length, serverNoun)}.`;
  return [opening, ...servers.map((server) => orgServerInWords(server))].join(' ');
}
