import type { Schema } from 'effect';

import type { McpServerFailed, ServerFailedBecause } from '../access/mcp-server-failed.ts';
import type { NotOfferedBecause, ToolNotOffered } from '../access/tool-not-offered.ts';
import { cutToFailureBound } from '../bounds/call-bounds.ts';
import { resultText, type AnswerBlock, type ToolAnnotations } from '../bounds/tool-results.ts';
import type { CallAnswered, CallFailed, CallFailedBecause } from '../calls/call-facts.ts';
import type { SentCall } from '../calls/tool-caller.ts';

export interface CallAnswer {
  readonly content: readonly AnswerBlock[];
  readonly structuredContent?: Schema.Json;
}

interface AnsweredCall {
  readonly kind: 'answered';
  readonly detail: string;
  readonly retryAfterMs: number | null;
  readonly annotations: ToolAnnotations | undefined;
}

export type AnsweredOnce =
  | (AnsweredCall & {
      readonly outcome: 'result';
      readonly answer: CallAnswer;
      readonly answered: CallAnswered;
    })
  | (AnsweredCall & { readonly outcome: 'tool_error'; readonly answered: CallAnswered })
  | (AnsweredCall & { readonly outcome: CallFailedBecause; readonly failed: CallFailed });

interface Unopened<Refused extends string, Because extends string> {
  readonly kind: 'unopened';
  readonly refused: Refused;
  readonly because: Because;
  readonly detail: string;
}

export type UnopenedOnce =
  | Unopened<'tool_not_offered', NotOfferedBecause>
  | Unopened<'mcp_server_failed', ServerFailedBecause>;

export type CalledOnce = UnopenedOnce | AnsweredOnce;

type Refusal<Refused extends ToolNotOffered | McpServerFailed> = Pick<Refused, 'because' | 'detail'>;

export function notOfferedOnce({ because, detail }: Refusal<ToolNotOffered>): UnopenedOnce {
  return { kind: 'unopened', refused: 'tool_not_offered', because, detail };
}

export function failedToOpenOnce({ because, detail }: Refusal<McpServerFailed>): UnopenedOnce {
  return { kind: 'unopened', refused: 'mcp_server_failed', because, detail: cutToFailureBound(detail) };
}

export function answeredOnce(
  sent: SentCall,
  scrub: (text: string) => string,
  annotations: ToolAnnotations | undefined,
): AnsweredOnce {
  const answered = { kind: 'answered', annotations, retryAfterMs: sent.done.retryAfterMs } as const;
  if (!sent.answered) {
    const { done, fact } = sent;
    return { ...answered, outcome: done.outcome, failed: fact, detail: cutToFailureBound(scrub(done.message)) };
  }
  const { done, fact } = sent;
  return done.outcome === 'result'
    ? { ...answered, outcome: done.outcome, answer: done.scrubbed, answered: fact, detail: '' }
    : { ...answered, outcome: done.outcome, answered: fact, detail: cutToFailureBound(resultText(done.scrubbed)) };
}
