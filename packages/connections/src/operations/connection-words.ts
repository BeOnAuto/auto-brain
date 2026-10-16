import { counted, listed, quoted, type Noun } from '@on.auto/operations';

import type { Connection, ConnectionStatus } from '../registry/connection.ts';

const connectionNoun: Noun = { one: 'connection', other: 'connections' };

const mostNamed = 20;

const standings: Readonly<Record<ConnectionStatus, string>> = {
  pending: 'waits for the person who added it to approve it',
  connected: 'is connected',
  broken: 'is broken',
  removed: 'was removed',
};

export function connectionNamed({ name }: Pick<Connection, 'name'>): string {
  return `the connection ${quoted(name)}`;
}

export function connectionStanding(connection: Pick<Connection, 'name' | 'status' | 'broken'>): string {
  const why = connection.broken === null ? '' : `: ${connection.broken}`;
  return `The connection ${quoted(connection.name)} ${standings[connection.status]}${why}.`;
}

function shortly({ name, status }: Connection): string {
  return `${quoted(name)}, ${status}`;
}

export function connectionsListed(connections: readonly Connection[]): string {
  if (connections.length === 0) {
    return 'The org has no connection.';
  }
  const named = connections.slice(0, mostNamed).map((connection) => shortly(connection));
  const others = connections.length - named.length;
  const verb = connections.length === 1 ? 'is' : 'are';
  return `There ${verb} ${counted(connections.length, connectionNoun)}: ${listed(others === 0 ? named : [...named, `${others} more`])}.`;
}

export const linkWords =
  'The person who added it approves it, and gives its credential where it takes one, on the page its link opens, within ten minutes.';
