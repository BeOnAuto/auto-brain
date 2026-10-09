import { Function, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { secretsOf } from '../bounds/secrets.ts';
import type { McpConnection } from '../connections/mcp-connection.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { StdioServerSettings } from '../settings/mcp-settings.ts';
import { openedFor } from './call-opening.ts';

const settings: StdioServerSettings = {
  type: 'stdio',
  name: 'notes',
  org: 'acme',
  brains: null,
  allowed: null,
  testable: [],
  record_content: false,
  request_id: null,
  secrets: [],
  command: '/usr/local/bin/notes-mcp-server',
  args: [],
  env: new Map(),
};

const hanging: ServerLink = {
  settings,
  take: () => Promise.withResolvers<McpConnection>().promise,
  renew: () => Promise.withResolvers<McpConnection>().promise,
  release: () => Promise.resolve(),
  stop: () => Promise.resolve(),
};

const listing = {
  secrets: secretsOf([Redacted.make('notes-key')]),
  timing: { ...defaultTiming, openMs: 10 },
  toolsListed: Function.constVoid,
};

describe('the opening of one call', () => {
  it('gives up on a connection that does not open within the open bound, as a server that could not be reached', async () => {
    expect(await openedFor({ server: 'notes', tool: 'search' }, hanging, listing)).toEqual({
      kind: 'unopened',
      refused: 'mcp_server_failed',
      because: 'unreachable',
      detail: 'The MCP server notes could not be used: The MCP server did not open a connection within 10 ms',
    });
  });
});
