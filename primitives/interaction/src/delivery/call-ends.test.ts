import { describe, expect, it } from 'vitest';

import { endOfCall } from './call-ends.ts';

describe('the end of one call of a channel’s tool', () => {
  it('is what the tool answered, its structured content where it gave one, and the size of it all', () => {
    expect([
      endOfCall({ outcome: 'result', content: [{ type: 'text', text: '{"ts":"1.1"}' }], bytes: 52 }),
      endOfCall({ outcome: 'result', content: [], structuredContent: { ts: '1.1' }, bytes: 48 }),
    ]).toEqual([
      { answered: { content: [{ type: 'text', text: '{"ts":"1.1"}' }], bytes: 52 } },
      { answered: { content: [], structuredContent: { ts: '1.1' }, bytes: 48 } },
    ]);
  });

  it('is a failure in the words every channel call shares, an interrupted call lost and a tool not offered named so', () => {
    expect([
      endOfCall({ outcome: 'server_failure', detail: 'The MCP server answered HTTP 429', retryAfterMs: 60_000 }),
      endOfCall({ outcome: 'cancelled', detail: '', retryAfterMs: null }),
      endOfCall({ outcome: 'not_offered', detail: 'No MCP server named chat is configured', retryAfterMs: null }),
    ]).toEqual([
      { failed: { because: 'server_failure', retryAfterMs: 60_000, detail: 'The MCP server answered HTTP 429' } },
      { failed: { because: 'lost', retryAfterMs: null, detail: '' } },
      {
        failed: {
          because: 'channel_not_offered',
          retryAfterMs: null,
          detail: 'No MCP server named chat is configured',
        },
      },
    ]);
  });
});
