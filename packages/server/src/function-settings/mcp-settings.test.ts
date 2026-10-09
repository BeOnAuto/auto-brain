import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const directory = mkdtempSync(join(tmpdir(), 'auto-brain-mcp-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-brain.yaml');
  writeFileSync(path, text);
  return path;
}

function authorizationOf(settings: ReturnType<typeof readSettings>): string | undefined {
  const [server] = settings.mcp.servers;
  const header = server?.type === 'http' ? server.headers.get('Authorization') : undefined;
  return header === undefined ? undefined : Redacted.value(header);
}

describe('the MCP servers of the server', () => {
  it('reads the servers, each with its allowed and testable tools, from the environment', () => {
    const settings = readSettings({
      MCP_SERVERS: JSON.stringify({ graph: { ...graph, allowed: ['search', 'execute'], testable: ['execute'] } }),
      GRAPH_API_KEY: apiKey,
    });

    expect(settings.mcp).toEqual({
      servers: [
        expect.objectContaining({ name: 'graph', org: 'acme', allowed: ['search', 'execute'], testable: ['execute'] }),
      ],
    });
    expect(authorizationOf(settings)).toBe(`Bearer ${apiKey}`);
  });

  it('reads them from the configuration file, its references resolved when the servers are read', () => {
    const path = configFile(
      'mcp_servers:\n  graph:\n    url: https://graph.example.com/mcp\n    org: acme\n    headers:\n      Authorization: Bearer ${GRAPH_API_KEY}\n',
    );

    expect(authorizationOf(readSettings({ CONFIG_FILE: path, GRAPH_API_KEY: apiKey }))).toBe(`Bearer ${apiKey}`);
  });

  it('stops the start at a server named as a model provider or a gateway, never printing a value', () => {
    const gateways = JSON.stringify([{ name: 'house', base_url: 'https://llm.example.com/v1' }]);
    const error = errorFrom({
      MODEL_GATEWAYS: gateways,
      MCP_SERVERS: JSON.stringify({ house: graph, anthropic: graph }),
      GRAPH_API_KEY: apiKey,
    });

    expect(error).toBe(
      'mcp_settings_invalid: The MCP server settings are invalid. ' +
        'MCP_SERVERS: /house: The name of a model provider or gateway, which a reasoning function could not tell apart from it; ' +
        'MCP_SERVERS: /anthropic: The name of a model provider or gateway, which a reasoning function could not tell apart from it',
    );
    expect(error).not.toContain(apiKey);
  });

  it('places a problem of the configuration file at its line', () => {
    const path = configFile('mcp_servers:\n  graph:\n    url: ftp://graph.example.com/mcp\n    org: acme\n');

    expect(errorFrom({ CONFIG_FILE: path })).toBe(
      `mcp_settings_invalid: The MCP server settings are invalid. ${path}:3:10 mcp_servers.graph.url: Expected an http or https URL`,
    );
  });
});

const refusedLists = [
  'mcp_servers:',
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

describe('the tools of an MCP server in the configuration file', () => {
  it('are read from the entry of the server', () => {
    const path = configFile(
      'mcp_servers:\n  graph:\n    url: https://graph.example.com/mcp\n    org: acme\n    allowed: [search, execute]\n    testable: [execute]\n  notes:\n    command: /usr/local/bin/notes-mcp-server\n    org: acme\n',
    );

    expect(
      readSettings({ CONFIG_FILE: path }).mcp.servers.map(({ name, allowed, testable }) => ({
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
      'mcp_settings_invalid: The MCP server settings are invalid. ' +
        `${path}:5:23 mcp_servers.graph.allowed[1]: Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots; ` +
        `${path}:5:37 mcp_servers.graph.allowed[2]: search is listed twice; ` +
        `${path}:10:16 mcp_servers.notes.testable[0]: allowed does not name execute, and a tool a function may not call cannot be tested either; ` +
        `${path}:10:25 mcp_servers.notes.testable[1]: * would vouch for every tool of the server, those it adds later among them; name each tool that is safe to test; ` +
        `${path}:14:14 mcp_servers.wiki.allowed: Expected at least one tool; leave allowed out to allow every tool; ` +
        `${path}:15:15 mcp_servers.wiki.testable: Expected at least one tool; leave testable out to test only the tools the server marks read-only`,
    );
  });
});

describe('tools listed beside the MCP servers in the configuration file', () => {
  it('stop the start at the line of allowed_tools or testable_tools, saying where a tool is allowed or marked testable', () => {
    const path = configFile(
      'mcp_servers:\n  graph:\n    url: https://graph.example.com/mcp\n    org: acme\nallowed_tools: [graph/search]\ntestable_tools: [graph/search]\n',
    );

    expect(errorFrom({ CONFIG_FILE: path })).toBe(
      `ConfigFileInvalid: The configuration file ${path} is invalid: ` +
        `${path}:5:16 allowed_tools: Not a setting this file holds; a tool is allowed on the entry of its server in mcp_servers, under allowed; ` +
        `${path}:6:17 testable_tools: Not a setting this file holds; a tool is marked testable on the entry of its server in mcp_servers, under testable`,
    );
  });
});

describe('the tools of an MCP server in the environment', () => {
  it('are refused at start with the pointer of each, never with a value', () => {
    const error = errorFrom({
      MCP_SERVERS: JSON.stringify({
        graph: { ...graph, allowed: ['search', '*'] },
        notes: { ...graph, testable: ['execute', 'execute'] },
        wiki: { ...graph, allowed: ['search'], testable: ['execute'] },
      }),
      GRAPH_API_KEY: apiKey,
    });

    expect(error).toBe(
      'mcp_settings_invalid: The MCP server settings are invalid. ' +
        'MCP_SERVERS: /graph/allowed/1: Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out; ' +
        'MCP_SERVERS: /notes/testable/1: execute is listed twice; ' +
        'MCP_SERVERS: /wiki/testable/0: allowed does not name execute, and a tool a function may not call cannot be tested either',
    );
    expect(error).not.toContain(apiKey);
  });
});
