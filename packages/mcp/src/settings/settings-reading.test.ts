import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readMcpSettings, type Environment, type McpServerSettings } from '../index.ts';

const context = { modelProviders: ['openai', 'anthropic', 'gateway'] };

const apiKey = 'graph-api-key-4f1d9a7c2b';

const secrets = { GRAPH_API_KEY: apiKey, GRAPH_CLIENT_SECRET: 'graph-client-secret-81c2' };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme' };

const limitless = { command: '/usr/local/bin/limitless-mcp-server', org: 'acme' };

const clientSecret = { client_id: 'brain', client_secret: '${GRAPH_CLIENT_SECRET}' };

function environmentOf(servers: unknown): Environment {
  return { ...secrets, MCP_SERVERS: JSON.stringify(servers) };
}

function serversOf(servers: unknown): readonly McpServerSettings[] {
  return Effect.runSync(readMcpSettings(environmentOf(servers), context)).servers;
}

function refusalOf(environment: Environment) {
  return Effect.runSync(Effect.flip(readMcpSettings(environment, context)));
}

function problemsOf(servers: unknown): readonly string[] {
  return refusalOf(environmentOf(servers)).problems.map(({ setting, detail }) => `${setting} ${detail}`);
}

function plain(values: ReadonlyMap<string, Redacted.Redacted>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...values].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

function secretValuesOf(server: McpServerSettings | undefined): Readonly<Record<string, string>> {
  if (server === undefined) {
    return {};
  }
  return plain(server.type === 'http' ? server.headers : server.env);
}

describe('reading an http server', () => {
  it('reads no server and allows every tool when neither setting is set', () => {
    expect(Effect.runSync(readMcpSettings({}, context))).toEqual({ servers: [], allowed: null });
  });

  it('reads an http entry with its headers resolved and redacted, and its org and brains', () => {
    const [server] = serversOf({
      graph: {
        ...graph,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
        brains: ['sales', 'support'],
        record_content: true,
        request_id: 'x-request-id',
      },
    });

    expect(server).toMatchObject({
      name: 'graph',
      type: 'http',
      url: graph.url,
      auth: null,
      org: 'acme',
      brains: ['sales', 'support'],
      record_content: true,
      request_id: 'x-request-id',
    });
    expect(secretValuesOf(server)).toEqual({ Authorization: `Bearer ${apiKey}` });
    expect(JSON.stringify(server)).not.toContain(apiKey);
  });

  it('reads an explicit http type and an entry with no headers', () => {
    expect(serversOf({ graph: { ...graph, type: 'http' } })).toMatchObject([{ type: 'http', headers: new Map() }]);
  });
});

describe('reading a stdio server', () => {
  it('reads a stdio entry with its own environment and arguments', () => {
    const [server] = serversOf({
      limitless: { ...limitless, type: 'stdio', args: ['--port', '0'], env: { LIMITLESS_API_KEY: '${GRAPH_API_KEY}' } },
    });

    expect(server).toMatchObject({
      name: 'limitless',
      type: 'stdio',
      command: limitless.command,
      args: ['--port', '0'],
      brains: null,
      record_content: false,
      request_id: null,
    });
    expect(secretValuesOf(server)).toEqual({ LIMITLESS_API_KEY: apiKey });
  });

  it('reads a stdio entry with no arguments and no environment', () => {
    expect(serversOf({ limitless })).toMatchObject([{ type: 'stdio', args: [], env: new Map() }]);
  });
});

describe('the shape of the servers', () => {
  it('refuses a setting that is not JSON, or not the shape of the servers', () => {
    expect(refusalOf({ MCP_SERVERS: '{graph' }).problems).toEqual([
      { setting: 'MCP_SERVERS', detail: '/: Expected JSON' },
    ]);
    expect(problemsOf({ graph: { ...graph, port: 8 } })).toEqual([
      'MCP_SERVERS /graph/port: Expected no excess property',
    ]);
    expect(problemsOf([])).toEqual([expect.stringMatching(/^MCP_SERVERS \/: Expected object/u)]);
  });

  it('refuses an entry with neither url nor command, or with both', () => {
    const oneOfTwo =
      'MCP_SERVERS /graph: Expected url for an http server or command for a stdio server, one of the two';

    expect(problemsOf({ graph: { org: 'acme' } })).toEqual([oneOfTwo]);
    expect(problemsOf({ graph: { ...graph, command: 'graph' } })).toEqual([oneOfTwo]);
  });

  it('refuses a typed entry without the field its type needs', () => {
    expect(problemsOf({ graph: { org: 'acme', type: 'http' } })).toEqual([
      'MCP_SERVERS /graph: Expected url for an http server',
    ]);
    expect(problemsOf({ limitless: { org: 'acme', type: 'stdio', url: graph.url } })).toEqual([
      'MCP_SERVERS /limitless: Expected command for a stdio server',
    ]);
  });
});

describe('the fields of the other type', () => {
  it('refuses the fields of a stdio server on an http server', () => {
    expect(problemsOf({ graph: { ...graph, type: 'http', command: 'graph', args: [], env: {} } })).toEqual([
      'MCP_SERVERS /graph/command: Not a field of an http server',
      'MCP_SERVERS /graph/args: Not a field of an http server',
      'MCP_SERVERS /graph/env: Not a field of an http server',
    ]);
  });

  it('refuses the fields of an http server on a stdio server', () => {
    const auth = { ...clientSecret, issuer: 'https://auth.example.com' };

    expect(problemsOf({ limitless: { ...limitless, type: 'stdio', url: graph.url, headers: {}, auth } })).toEqual([
      'MCP_SERVERS /limitless/url: Not a field of a stdio server',
      'MCP_SERVERS /limitless/headers: Not a field of a stdio server',
      'MCP_SERVERS /limitless/auth: Not a field of a stdio server',
    ]);
  });
});

describe('the name, org and brains of a server', () => {
  it('refuses a name a reasoning function could not write, or could mistake for a model provider or gateway', () => {
    expect(problemsOf({ Graph: graph })).toEqual([
      'MCP_SERVERS /Graph: Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
    ]);
    expect(problemsOf({ openai: graph, gateway: graph })).toEqual([
      'MCP_SERVERS /openai: The name of a model provider or gateway, which a reasoning function could not tell apart from it',
      'MCP_SERVERS /gateway: The name of a model provider or gateway, which a reasoning function could not tell apart from it',
    ]);
  });

  it('refuses an entry without its org, or with an org or brain that is not an id, with every other problem', () => {
    expect(problemsOf({ Graph: { url: graph.url } })).toEqual([
      'MCP_SERVERS /Graph: Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      'MCP_SERVERS /Graph: Expected the org this server serves',
    ]);
    expect(problemsOf({ graph: { ...graph, org: 'acme corp', brains: ['sales', 'Support Desk'] } })).toEqual([
      'MCP_SERVERS /graph/org: Expected an org id',
      'MCP_SERVERS /graph/brains/1: Expected a brain id',
    ]);
  });
});

describe('the transport of a server', () => {
  it('refuses a url that is not http, a header name that is not one, and a header the client sets itself', () => {
    const headers = { 'X Graph': 'one', 'Mcp-Session-Id': 'two' };

    expect(problemsOf({ graph: { url: 'ftp://graph.example.com/mcp', org: 'acme', headers } })).toEqual([
      'MCP_SERVERS /graph/url: Expected an http or https URL',
      'MCP_SERVERS /graph/headers/X Graph: Expected a header name',
      'MCP_SERVERS /graph/headers/Mcp-Session-Id: A header the MCP client sets itself',
    ]);
  });

  it('refuses a blank command and an environment variable that is not a name', () => {
    expect(problemsOf({ limitless: { ...limitless, command: ' ', env: { '1KEY': 'one', 'A-B': 'two' } } })).toEqual([
      'MCP_SERVERS /limitless/command: Expected a command',
      'MCP_SERVERS /limitless/env/1KEY: Expected an environment variable name',
      'MCP_SERVERS /limitless/env/A-B: Expected an environment variable name',
    ]);
  });
});

describe('the secrets of a server', () => {
  it('refuses a credential written out instead of referenced, and a reference to a variable that is not set, never printing a value', () => {
    const headers = { Authorization: 'Bearer abk_live_9f8e7d6c5b4a', 'X-Tenant': '${GRAPH_TENANT}' };
    const refusal = refusalOf(environmentOf({ graph: { ...graph, headers } }));

    expect(refusal.problems).toEqual([
      {
        setting: 'MCP_SERVERS',
        detail:
          '/graph/headers/Authorization: Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}',
      },
      {
        setting: 'MCP_SERVERS',
        detail: '/graph/headers/X-Tenant: Refers to the environment variable GRAPH_TENANT, which is not set',
      },
    ]);
    expect(refusal.message).toMatch(
      /^The MCP server settings are invalid\. MCP_SERVERS: \/graph\/headers\/Authorization/u,
    );
    expect(JSON.stringify(refusal)).not.toContain('abk_live');
  });
});

describe('a credential written into the url or the args of a server', () => {
  it('is refused as userinfo, as a value of the query, and after the = of an argument, never printing it', () => {
    const credential =
      'Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}';
    const refusal = refusalOf(
      environmentOf({
        graph: { ...graph, url: 'https://a.example/mcp?key=sk-live-x' },
        crm: { ...graph, url: 'https://user:sk-x@a.example/mcp' },
        limitless: { ...limitless, args: ['--key=sk-live-x'] },
      }),
    );

    expect(refusal.problems.map(({ detail }) => detail)).toEqual([
      `/graph/url: ${credential}`,
      `/crm/url: ${credential}`,
      `/limitless/args/0: ${credential}`,
    ]);
    expect(JSON.stringify(refusal)).not.toContain('sk-');
  });

  it('is judged by the value, never by the name it is given', () => {
    const [notes, graphOfTokens] = serversOf({
      notes: { ...limitless, args: ['--token-file=/run/secrets/notes', '--api-key-env=NOTES_API_KEY'] },
      graph: { ...graph, url: 'https://graph.example.com/mcp?token_type=bearer' },
    });

    expect([notes?.name, graphOfTokens?.name]).toEqual(['notes', 'graph']);
  });
});

describe('the references of a server', () => {
  it('refuses a reference outside headers, env and auth, where a key would show in a process listing or a URL', () => {
    const misplaced =
      'Holds a reference to an environment variable, which only headers, env and auth may hold: an argument shows in the listing of the processes of the machine, and a URL is not a header';

    expect(
      problemsOf({
        graph: { ...graph, url: 'https://graph.example.com/mcp?key=${GRAPH_API_KEY}' },
        limitless: { ...limitless, args: ['--key', '${GRAPH_API_KEY}'], command: '${HOME:-/usr/local}/bin/limitless' },
      }),
    ).toEqual([
      `MCP_SERVERS /graph/url: ${misplaced}`,
      `MCP_SERVERS /limitless/command: ${misplaced}`,
      `MCP_SERVERS /limitless/args/1: ${misplaced}`,
    ]);
  });

  it('keeps the values of the references in headers and env as the secrets of the server', () => {
    const [server] = serversOf({
      graph: { ...graph, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Mode': '${MODE:-production}' } },
    });

    expect(server?.secrets.map((secret) => Redacted.value(secret))).toEqual([apiKey]);
  });
});
