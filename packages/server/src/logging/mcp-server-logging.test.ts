import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logServerMessage } from './logging.ts';

describe('logServerMessage', () => {
  it('tells a line an MCP server wrote, as information', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({ server: 'limitless', message: 'Listening on stdio', execution_id: null }),
    );

    expect(line).toContain('"message":"MCP server limitless wrote: Listening on stdio","level":"INFO"');
    expect(line).toContain('"annotations":{"mcp_server":"limitless"}');
  });

  it('warns of a call an MCP server failed, with the execution and what the server said', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({
        server: 'graph',
        message: 'The MCP server answered HTTP 503',
        execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      }),
    );

    expect(line).toContain('"message":"MCP server graph failed a call","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"mcp_server":"graph","execution_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","server_message":"The MCP server answered HTTP 503"}',
    );
  });
});
