import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineListToolServers, defineListToolServersInOrg } from '../index.ts';

const { registration } = defineListToolServers({ listServers: () => Effect.succeed([]) });

const words = registration.plainLanguage;

function tool(name: string, testable = false) {
  return { name, description: '', input_schema: {}, testable };
}

const lookups = Array.from({ length: 23 }, (_, index) => tool(`lookup_${index + 1}`));

const gateway = ['search', 'introspect', 'execute', 'validate', 'dry_run'].map((name) =>
  tool(name, name === 'search' || name === 'introspect'),
);

const servers = {
  tool_servers: [
    { name: 'graph', type: 'http', record_content: true, tools: [tool('search', true), tool('graph.query.v2')] },
    { name: 'limitless', type: 'stdio', record_content: true, tools: [tool('getLifelogs')] },
    { name: 'notes', type: 'http', record_content: true, tools: lookups },
    { name: 'quiet', type: 'http', record_content: true, tools: [] },
    {
      name: 'vault',
      type: 'http',
      record_content: true,
      unavailable: 'The MCP server vault could not be used',
      because: 'key_refused',
    },
    {
      name: 'wiki',
      type: 'http',
      record_content: true,
      unavailable: 'The MCP server wiki could not be used',
      because: 'unreachable',
    },
  ],
};

describe('the plain words of list_tool_servers', () => {
  it('say what it tried to do', () => {
    expect(words?.attempt({})).toBe("list the tool servers this brain's functions may use");
    expect(words?.attempt({ server: 'graph' })).toBe('list the tools of the tool server “graph”');
    expect(words?.attempt({ server: 'Not A Server' })).toBe("list the tool servers this brain's functions may use");
  });

  it('say that no tool server is set up for the brain, who can set one up and where it says what they need', () => {
    expect(words?.outcome({ tool_servers: [] }, {})).toBe(
      'Whoever runs this server has set up no tool server for this brain, so its functions can call no tools until they set one up; the give-tools guide says what they need.',
    );
  });

  it('name each server and its tools in words, twenty at most, and say which could not be asked', () => {
    const named = Array.from({ length: 20 }, (_, index) => `lookup ${index + 1}`).join(', ');

    expect(words?.outcome(servers, {})).toBe(
      [
        "This brain's functions may use 6 tool servers.",
        '“graph” offers 2 tools: search and graph query v2; search can be tested.',
        '“limitless” offers 1 tool: get lifelogs; none can be tested.',
        `“notes” offers 23 tools: ${named}, and 3 more; none can be tested.`,
        '“quiet” offers no tool this brain may use.',
        '“vault” did not accept the key this server gives it, so whoever runs this server can check that key.',
        '“wiki” could not be asked for its tools just now.',
      ].join(' '),
    );
  });

  it('name the tools of a server that can be tested, as a gateway marks its readers', () => {
    expect(
      words?.outcome({ tool_servers: [{ name: 'graph', type: 'http', record_content: true, tools: gateway }] }, {}),
    ).toBe(
      "This brain's functions may use 1 tool server. “graph” offers 5 tools: search, introspect, execute, validate, and dry run; search and introspect can be tested.",
    );
  });
});

const inOrg = defineListToolServersInOrg(
  { listServers: () => Effect.succeed([]), brainsServedBy: () => [] },
  () => Effect.void,
).registration.plainLanguage;

describe('the plain words of list_tool_servers for the org', () => {
  it('say what it tried to do, for the org or for the brain asked for', () => {
    expect(inOrg?.attempt({})).toBe('list the tool servers the brains of this org may use');
    expect(inOrg?.attempt({ brain: 'alpha' })).toBe("list the tool servers this brain's functions may use");
    expect(inOrg?.attempt({ server: 'graph' })).toBe('list the tools of the tool server “graph”');
  });

  it('say that no tool server is set up for the org, who can set one up and where it says what they need', () => {
    expect(inOrg?.outcome({ tool_servers: [] }, {})).toBe(
      'Whoever runs this server has set up no tool server for this org, so the functions of its brains can call no tools until they set one up; the give-tools guide says what they need.',
    );
  });

  it('name each server with the brains it serves, its tools, and say which could not be asked', () => {
    const inTheOrg = [
      { name: 'graph', type: 'http', record_content: true, brains: ['*'], tools: [tool('search', true)] },
      { name: 'notes', type: 'http', record_content: true, brains: ['alpha'], tools: [] },
      {
        name: 'vault',
        type: 'http',
        record_content: true,
        brains: ['alpha', 'beta'],
        unavailable: 'Refused',
        because: 'key_refused',
      },
      { name: 'wiki', type: 'stdio', record_content: true, brains: [], unavailable: 'Gone', because: 'unreachable' },
    ];

    expect(inOrg?.outcome({ tool_servers: inTheOrg }, {})).toBe(
      [
        'The brains of this org may use 4 tool servers.',
        '“graph”, for every brain, offers 1 tool: search; search can be tested.',
        '“notes”, for the brain “alpha”, offers no tool a function may use.',
        '“vault”, for the brains “alpha” and “beta”, did not accept the key this server gives it, so whoever runs this server can check that key.',
        '“wiki”, for no brain, could not be asked for its tools just now.',
      ].join(' '),
    );
  });

  it('speak of the brain asked for as the brain itself does', () => {
    const forTheBrain = [
      { name: 'graph', type: 'http', record_content: true, brains: ['*'], tools: [tool('search', true)] },
    ];

    expect(inOrg?.outcome({ tool_servers: forTheBrain }, { brain: 'alpha' })).toBe(
      "This brain's functions may use 1 tool server. “graph” offers 1 tool: search; search can be tested.",
    );
  });
});
