import type { Settled } from '@beonauto/operations';
import type { CallToolResult } from '@modelcontextprotocol/server';

import { problemOfOutcome } from '../problem/outcome-problem.ts';
import type { Problem } from '../problem/problem.ts';

export function problemResultOf(problem: Problem): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(problem) }] };
}

export function toolResultOf(settled: Settled, clientClosedRequest: boolean): CallToolResult {
  if (settled.status === 'succeeded') {
    return {
      content: [{ type: 'text', text: JSON.stringify(settled.output) }],
      structuredContent: settled.output,
    };
  }
  return problemResultOf(problemOfOutcome(settled, clientClosedRequest));
}
