import type { Settled } from '@beonauto/operations';
import type { CallToolResult } from '@modelcontextprotocol/server';

import { problemOfOutcome } from '../problem/outcome-problem.ts';

export function toolResultOf(settled: Settled, clientClosedRequest: boolean): CallToolResult {
  if (settled.status === 'succeeded') {
    return {
      content: [{ type: 'text', text: JSON.stringify(settled.output) }],
      structuredContent: settled.output,
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(problemOfOutcome(settled, clientClosedRequest)) }],
  };
}
