import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from '../settings/settings.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const graph = {
  url: 'https://graph.example.com/mcp',
  org: 'acme',
  headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
};

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettings(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-tool-servers-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

function authorizationOf(settings: ReturnType<typeof readSettings>): string | undefined {
  const [server] = settings.toolServers.servers;
  const header = server?.type === 'mcp' ? server.headers.get('Authorization') : undefined;
  return header === undefined ? undefined : Redacted.value(header);
}

describe('the tool servers of the server', () => {
  it('reads the servers, each with its allowed and testable tools, from the environment', () => {
    const settings = readSettings({
      TOOL_SERVERS: JSON.stringify({ graph: { ...graph, allowed: ['search', 'execute'], testable: ['execute'] } }),
      GRAPH_API_KEY: apiKey,
    });

    expect(settings.toolServers).toEqual({
      servers: [
        expect.objectContaining({
          name: 'graph',
          orgs: ['acme'],
          allowed: ['search', 'execute'],
          testable: ['execute'],
        }),
      ],
    });
    expect(authorizationOf(settings)).toBe(`Bearer ${apiKey}`);
  });

  it('reads them from the configuration file, its references resolved when the servers are read', () => {
    const path = configFile(
      'tool_servers:\n  graph:\n    url: https://graph.example.com/mcp\n    org: acme\n    headers:\n      Authorization: Bearer ${GRAPH_API_KEY}\n',
    );

    expect(authorizationOf(readSettings({ CONFIG_FILE: path, GRAPH_API_KEY: apiKey }))).toBe(`Bearer ${apiKey}`);
  });
});

describe('the tool servers the server refuses', () => {
  it('stops the start at a server named as a model provider or a gateway, never printing a value', () => {
    const gateways = JSON.stringify([{ name: 'house', base_url: 'https://llm.example.com/v1' }]);
    const error = errorFrom({
      MODEL_GATEWAYS: gateways,
      TOOL_SERVERS: JSON.stringify({ house: graph, anthropic: graph }),
      GRAPH_API_KEY: apiKey,
    });

    expect(error).toBe(
      'tool_server_settings_invalid: The tool server settings are invalid. ' +
        'TOOL_SERVERS: /house: The name of a model provider or gateway, which a reasoning function could not tell apart from it; ' +
        'TOOL_SERVERS: /anthropic: The name of a model provider or gateway, which a reasoning function could not tell apart from it',
    );
    expect(error).not.toContain(apiKey);
  });

  it('places a problem of the configuration file at its line', () => {
    const path = configFile('tool_servers:\n  graph:\n    url: ftp://graph.example.com/mcp\n    org: acme\n');

    expect(errorFrom({ CONFIG_FILE: path })).toBe(
      `tool_server_settings_invalid: The tool server settings are invalid. ${path}:3:10 tool_servers.graph.url: Expected an http or https URL`,
    );
  });
});

const refusedLists = [
  'tool_servers:',
  '  graph:',
  '    url: https://graph.example.com/mcp',
  '    org: acme',
  '    allowed: [search, graph/search, search]',
  '  notes:',
  '    command: /usr/local/bin/notes-mcp-server',
  '    org: acme',
  '    allowed: [search]',
  '    testable: [execute, "*"]',
  '  wiki:',
  '    command: /usr/local/bin/wiki-mcp-server',
  '    org: acme',
  '    allowed: []',
  '    testable: []',
  '',
].join('\n');

describe('the tools of a tool server in the configuration file', () => {
  it('are read from the entry of the server', () => {
    const path = configFile(
      'tool_servers:\n  graph:\n    url: https://graph.example.com/mcp\n    org: acme\n    allowed: [search, execute]\n    testable: [execute]\n  notes:\n    command: /usr/local/bin/notes-mcp-server\n    org: acme\n',
    );

    expect(
      readSettings({ CONFIG_FILE: path }).toolServers.servers.map(({ name, allowed, testable }) => ({
        name,
        allowed,
        testable,
      })),
    ).toEqual([
      { name: 'graph', allowed: ['search', 'execute'], testable: ['execute'] },
      { name: 'notes', allowed: null, testable: [] },
    ]);
  });

  it('stop the start at the line of each one refused, never with a value', () => {
    const path = configFile(refusedLists);

    expect(errorFrom({ CONFIG_FILE: path })).toBe(
      'tool_server_settings_invalid: The tool server settings are invalid. ' +
        `${path}:5:23 tool_servers.graph.allowed[1]: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots; ` +
        `${path}:5:37 tool_servers.graph.allowed[2]: search is listed twice; ` +
        `${path}:10:16 tool_servers.notes.testable[0]: allowed does not name execute, and a tool a function may not call cannot be tested either; ` +
        `${path}:10:25 tool_servers.notes.testable[1]: * would vouch for every tool of the server, those it adds later among them; name each tool that is safe to test; ` +
        `${path}:14:14 tool_servers.wiki.allowed: Expected at least one tool; leave allowed out to allow every tool; ` +
        `${path}:15:15 tool_servers.wiki.testable: Expected at least one tool; leave testable out to test only the tools the server marks read-only`,
    );
  });
});

describe('a key the configuration file does not hold beside the tool servers', () => {
  it('stops the start at its line, as any key the file does not hold', () => {
    const path = configFile('tool_servers: {}\ntool_server_names: [graph]\n');

    expect(errorFrom({ CONFIG_FILE: path })).toBe(
      `ConfigFileInvalid: The configuration file ${path} is invalid: ${path}:2:20 tool_server_names: Not a setting this file holds; ` +
        'it holds allowed_origins, api_keys, model_gateways, model_aliases, declared_models, allowed_models, tool_servers',
    );
  });
});

describe('the document of an openapi server named by a path in the configuration file', () => {
  it('is read from the directory of the configuration file', () => {
    const path = configFile('tool_servers:\n  billing:\n    document: apis/billing.json\n    org: acme\n');

    expect(readSettings({ CONFIG_FILE: path }).toolServers.servers).toMatchObject([
      { name: 'billing', type: 'openapi', document: { kind: 'file', path: join(dirname(path), 'apis/billing.json') } },
    ]);
  });
});

describe('the tools of a tool server in the environment', () => {
  it('are refused at start with the pointer of each, never with a value', () => {
    const error = errorFrom({
      TOOL_SERVERS: JSON.stringify({
        graph: { ...graph, allowed: ['search', '*'] },
        notes: { ...graph, testable: ['execute', 'execute'] },
        wiki: { ...graph, allowed: ['search'], testable: ['execute'] },
      }),
      GRAPH_API_KEY: apiKey,
    });

    expect(error).toBe(
      'tool_server_settings_invalid: The tool server settings are invalid. ' +
        'TOOL_SERVERS: /graph/allowed/1: Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out; ' +
        'TOOL_SERVERS: /notes/testable/1: execute is listed twice; ' +
        'TOOL_SERVERS: /wiki/testable/0: allowed does not name execute, and a tool a function may not call cannot be tested either',
    );
    expect(error).not.toContain(apiKey);
  });
});
