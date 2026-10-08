import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readMcpSettings, type Environment } from '../index.ts';

const context = { modelProviders: ['openai'] };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme', headers: { Authorization: 'Bearer ${GRAPH_KEY}' } };

const notes = { command: '/usr/local/bin/notes-mcp-server', org: 'acme' };

const key = 'graph-api-key-4f1d9a7c2b';

interface Lists {
  readonly allowed?: unknown;
  readonly testable?: unknown;
}

function environmentOf({ allowed, testable }: Lists): Environment {
  return {
    GRAPH_KEY: key,
    MCP_SERVERS: JSON.stringify({ graph, notes }),
    ...(allowed === undefined ? {} : { ALLOWED_TOOLS: JSON.stringify(allowed) }),
    ...(testable === undefined ? {} : { TESTABLE_TOOLS: JSON.stringify(testable) }),
  };
}

function testableOf(lists: Lists) {
  return Effect.runSync(readMcpSettings(environmentOf(lists), context)).testable;
}

function problemsOf(environment: Environment): readonly string[] {
  return Effect.runSync(Effect.flip(readMcpSettings(environment, context))).problems.map(
    ({ setting, detail }) => `${setting} ${detail}`,
  );
}

describe('reading the tools that may be tested', () => {
  it('reads them beside the allowed tools, in the shape of the allowed tools', () => {
    expect(
      testableOf({ allowed: ['graph/search', 'graph/execute', 'notes/*'], testable: ['graph/execute', 'notes/*'] }),
    ).toEqual([
      { server: 'graph', tool: 'execute' },
      { server: 'notes', tool: '*' },
    ]);
  });

  it('are none when left out, so only the tools their servers mark read-only can be tested', () => {
    expect(testableOf({ allowed: ['graph/search'] })).toEqual([]);
    expect(testableOf({})).toEqual([]);
  });

  it('may be any tool of a server when every tool is allowed', () => {
    expect(testableOf({ testable: ['graph/execute'] })).toEqual([{ server: 'graph', tool: 'execute' }]);
  });
});

describe('the tools that may be tested, refused at start', () => {
  it('refuses a list that is not JSON, not a list, or empty, naming its setting and pointer', () => {
    expect(problemsOf({ ...environmentOf({}), TESTABLE_TOOLS: '[graph' })).toEqual(['TESTABLE_TOOLS /: Expected JSON']);
    expect(problemsOf(environmentOf({ testable: 'graph/execute' }))).toEqual([
      expect.stringMatching(/^TESTABLE_TOOLS \/: Expected array/u),
    ]);
    expect(problemsOf(environmentOf({ testable: [] }))).toEqual([
      'TESTABLE_TOOLS /: Expected at least one tool; leave TESTABLE_TOOLS out to test only the tools their servers mark read-only',
    ]);
  });

  it('refuses a tool that is malformed, listed twice, of no configured server, or not allowed, never printing a value', () => {
    const problems = problemsOf(
      environmentOf({
        allowed: ['graph/search', 'notes/*'],
        testable: ['graph', 'notes/write', 'notes/write', 'crm/find', 'graph/execute'],
      }),
    );

    expect(problems).toEqual([
      expect.stringMatching(/^TESTABLE_TOOLS \/0: Expected server\/tool, or server\/\* for every tool of a server/u),
      'TESTABLE_TOOLS /2: notes/write is listed twice',
      'TESTABLE_TOOLS /3: There is no MCP server named crm',
      'TESTABLE_TOOLS /4: ALLOWED_TOOLS does not allow graph/execute, and a tool a function may not call cannot be tested either',
    ]);
    expect(problems.join(' ')).not.toContain(key);
  });

  it('reports the problems of the allowed tools alone while they cannot be read', () => {
    expect(problemsOf(environmentOf({ allowed: [], testable: ['graph/execute'] }))).toEqual([
      'ALLOWED_TOOLS /: Expected at least one tool; leave ALLOWED_TOOLS out to allow every tool',
    ]);
  });
});
