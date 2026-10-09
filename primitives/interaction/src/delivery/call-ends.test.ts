import { describe, expect, it } from 'vitest';

import { endOfCall } from './call-ends.ts';

const answered = {
  kind: 'answered',
  fields: { result_bytes: 52, result_sha256: null, jsonrpc_id: 1 },
  durationMs: 3,
} as const;

describe('the end of one call of a tool the brain makes', () => {
  it('is what the tool answered, its structured content where it gave one', () => {
    expect([
      endOfCall({
        ...answered,
        outcome: 'result',
        answer: { content: [{ type: 'text', text: '{"ts":"1.1"}' }] },
        detail: '',
        retryAfterMs: null,
      }),
      endOfCall({
        ...answered,
        outcome: 'result',
        answer: { content: [], structuredContent: { ts: '1.1' } },
        detail: '',
        retryAfterMs: null,
      }),
    ]).toEqual([
      { answered: { content: [{ type: 'text', text: '{"ts":"1.1"}' }] } },
      { answered: { content: [], structuredContent: { ts: '1.1' } } },
    ]);
  });

  it('is a failure in the words every call of the brain shares, and an interrupted call lost', () => {
    expect([
      endOfCall({
        ...answered,
        outcome: 'server_failure',
        detail: 'The MCP server answered HTTP 429',
        retryAfterMs: 60_000,
      }),
      endOfCall({ ...answered, outcome: 'cancelled', detail: '', retryAfterMs: null }),
      endOfCall({ ...answered, outcome: 'tool_error', detail: 'Denied', retryAfterMs: null }),
      endOfCall({ ...answered, outcome: 'timed_out', detail: 'Late', retryAfterMs: null }),
    ]).toEqual([
      { failed: { because: 'server_failure', retryAfterMs: 60_000, detail: 'The MCP server answered HTTP 429' } },
      { failed: { because: 'lost', retryAfterMs: null, detail: '' } },
      { failed: { because: 'tool_error', retryAfterMs: null, detail: 'Denied' } },
      { failed: { because: 'timed_out', retryAfterMs: null, detail: 'Late' } },
    ]);
  });
});
