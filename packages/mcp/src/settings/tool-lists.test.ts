import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readMcpSettings, type Environment } from '../index.ts';

const context = { modelProviders: ['openai'] };

const key = 'graph-api-key-4f1d9a7c2b';

const graph = { url: 'https://graph.example.com/mcp', org: 'acme', headers: { Authorization: 'Bearer ${GRAPH_KEY}' } };

const notes = { command: '/usr/local/bin/notes-mcp-server', org: 'acme' };

function environmentOf(servers: unknown): Environment {
  return { GRAPH_KEY: key, MCP_SERVERS: JSON.stringify(servers) };
}

function listsOf(servers: unknown) {
  return Effect.runSync(readMcpSettings(environmentOf(servers), context)).servers.map(
    ({ name, allowed, testable }) => ({ name, allowed, testable }),
  );
}

function problemsOf(servers: unknown): readonly string[] {
  return Effect.runSync(Effect.flip(readMcpSettings(environmentOf(servers), context))).problems.map(
    ({ setting, detail }) => `${setting} ${detail}`,
  );
}

describe('the tools of a server, on its entry', () => {
  it('reads the tools allowed and those marked testable, each named as the server lists it', () => {
    expect(
      listsOf({
        graph: { ...graph, allowed: ['search', 'introspect', 'execute'], testable: ['search', 'introspect'] },
        notes: { ...notes, allowed: ['graph.query.v2'] },
      }),
    ).toEqual([
      { name: 'graph', allowed: ['search', 'introspect', 'execute'], testable: ['search', 'introspect'] },
      { name: 'notes', allowed: ['graph.query.v2'], testable: [] },
    ]);
  });

  it('allows every tool and marks none testable on a server with neither field', () => {
    expect(listsOf({ graph, notes: { ...notes, testable: ['write'] } })).toEqual([
      { name: 'graph', allowed: null, testable: [] },
      { name: 'notes', allowed: null, testable: ['write'] },
    ]);
  });
});

describe('the tools of a server, refused at start', () => {
  it('refuses a name that is not a tool name, at its pointer and never with a value', () => {
    const problems = problemsOf({ graph: { ...graph, allowed: ['graph/search', ''], testable: ['graph/search'] } });

    expect(problems).toEqual([
      'MCP_SERVERS /graph/allowed/0: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
      'MCP_SERVERS /graph/allowed/1: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
      'MCP_SERVERS /graph/testable/0: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots',
    ]);
    expect(problems.join(' ')).not.toContain(key);
  });

  it('refuses * in either list, with what to write instead', () => {
    expect(problemsOf({ graph: { ...graph, allowed: ['search', '*'], testable: ['*'] } })).toEqual([
      'MCP_SERVERS /graph/allowed/1: Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out',
      'MCP_SERVERS /graph/testable/0: * would vouch for every tool of the server, those it adds later among them; name each tool that is safe to test',
    ]);
  });
});

describe('the tools of a server, refused at start in their number and their relation', () => {
  it('refuses a tool listed twice', () => {
    expect(
      problemsOf({ graph: { ...graph, allowed: ['search', 'execute', 'search'], testable: ['execute', 'execute'] } }),
    ).toEqual([
      'MCP_SERVERS /graph/allowed/2: search is listed twice',
      'MCP_SERVERS /graph/testable/1: execute is listed twice',
    ]);
  });

  it('refuses an empty list, saying what leaving it out means', () => {
    expect(problemsOf({ graph: { ...graph, allowed: [] }, notes: { ...notes, testable: [] } })).toEqual([
      'MCP_SERVERS /graph/allowed: Expected at least one tool; leave allowed out to allow every tool',
      'MCP_SERVERS /notes/testable: Expected at least one tool; leave testable out to test only the tools the server marks read-only',
    ]);
  });

  it('refuses a tool marked testable that allowed does not name', () => {
    expect(problemsOf({ graph: { ...graph, allowed: ['search'], testable: ['search', 'execute'] } })).toEqual([
      'MCP_SERVERS /graph/testable/1: allowed does not name execute, and a tool a function may not call cannot be tested either',
    ]);
  });

  it('checks testable as if every tool were allowed while allowed cannot be read', () => {
    expect(problemsOf({ graph: { ...graph, allowed: ['*'], testable: ['execute', '*'] } })).toEqual([
      'MCP_SERVERS /graph/allowed/0: Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out',
      'MCP_SERVERS /graph/testable/1: * would vouch for every tool of the server, those it adds later among them; name each tool that is safe to test',
    ]);
  });

  it('refuses a list that is not a list of names', () => {
    expect(problemsOf({ graph: { ...graph, allowed: 'search' } })).toEqual([
      'MCP_SERVERS /graph/allowed: Expected array',
    ]);
  });
});
