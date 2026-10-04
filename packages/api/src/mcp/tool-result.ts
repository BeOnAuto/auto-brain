import {
  unsuccessfulWords,
  type OperationKind,
  type RegisteredPlainLanguage,
  type Settled,
} from '@beonauto/operations';
import type { CallToolResult } from '@modelcontextprotocol/server';

import { problemOfOutcome } from '../problem/outcome-problem.ts';

export interface ToolWords {
  readonly kind: OperationKind;
  readonly plainLanguage: RegisteredPlainLanguage;
}

function textOf(text: string): { readonly type: 'text'; readonly text: string } {
  return { type: 'text', text };
}

export function toolResultOf(
  settled: Settled,
  clientClosedRequest: boolean,
  { kind, plainLanguage }: ToolWords,
  input: unknown,
): CallToolResult {
  if (settled.status === 'succeeded') {
    return {
      content: [textOf(plainLanguage.outcome(settled.output, input)), textOf(JSON.stringify(settled.output))],
      structuredContent: settled.output,
    };
  }
  return {
    isError: true,
    content: [
      textOf(unsuccessfulWords(plainLanguage.attempt(input), kind, settled)),
      textOf(JSON.stringify(problemOfOutcome(settled, clientClosedRequest))),
    ],
  };
}
