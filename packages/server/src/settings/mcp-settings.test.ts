import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from './settings.ts';

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
  it('reads the servers and the allowed tools from the environment', () => {
    const settings = readSettings({
      MCP_SERVERS: JSON.stringify({ graph }),
      ALLOWED_TOOLS: JSON.stringify(['graph/search']),
      GRAPH_API_KEY: apiKey,
    });

    expect(settings.mcp).toMatchObject({
      servers: [{ name: 'graph', org: 'acme' }],
      allowed: [{ server: 'graph', tool: 'search' }],
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

describe('the tools of the MCP servers that may be tested', () => {
  it('are read from the environment and from the configuration file', () => {
    const fromEnvironment = readSettings({
      MCP_SERVERS: JSON.stringify({ graph }),
      TESTABLE_TOOLS: JSON.stringify(['graph/execute']),
      GRAPH_API_KEY: apiKey,
    });
    const path = configFile(
      'mcp_servers:\n  graph:\n    url: https://graph.example.com/mcp\n    org: acme\nallowed_tools: [graph/search, graph/execute]\ntestable_tools: [graph/execute]\n',
    );

    expect([fromEnvironment.mcp.testable, readSettings({ CONFIG_FILE: path }).mcp.testable]).toEqual([
      [{ server: 'graph', tool: 'execute' }],
      [{ server: 'graph', tool: 'execute' }],
    ]);
  });

  it('stop the start when one is not allowed, placed at its line in the configuration file', () => {
    const path = configFile(
      'mcp_servers:\n  graph:\n    url: https://graph.example.com/mcp\n    org: acme\nallowed_tools: [graph/search]\ntestable_tools: [graph/execute]\n',
    );

    expect(errorFrom({ CONFIG_FILE: path })).toBe(
      `mcp_settings_invalid: The MCP server settings are invalid. ${path}:6:18 testable_tools[0]: ALLOWED_TOOLS does not allow graph/execute, and a tool a function may not call cannot be tested either`,
    );
  });
});
