import type { Schema } from 'effect';

import type { McpServerFailed, ServerFailedBecause } from '../access/mcp-server-failed.ts';
import type { NotOfferedBecause, ToolNotOffered } from '../access/tool-not-offered.ts';
import { cutToFailureBound } from '../bounds/call-bounds.ts';
import { answerOf, resultText, type AnswerBlock, type ToolAnnotations } from '../bounds/tool-results.ts';
import type { CallOutcome } from '../calls/call-facts.ts';
import { answeredFields, type AnsweredFields, type Recording } from '../calls/recorded-calls.ts';
import type { Forwarded } from '../calls/tool-calls.ts';

export interface CallAnswer {
  readonly content: readonly AnswerBlock[];
  readonly structuredContent?: Schema.Json;
}

interface AnsweredCall {
  readonly kind: 'answered';
  readonly fields: AnsweredFields;
  readonly durationMs: number;
  readonly detail: string;
  readonly retryAfterMs: number | null;
  readonly annotations: ToolAnnotations | undefined;
}

export type AnsweredOnce =
  | (AnsweredCall & { readonly outcome: 'result'; readonly answer: CallAnswer })
  | (AnsweredCall & { readonly outcome: Exclude<CallOutcome, 'result'> });

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

export interface Answering {
  readonly durationMs: number;
  readonly recording: Recording;
  readonly annotations: ToolAnnotations | undefined;
}

export function answeredOnce(done: Forwarded, { durationMs, recording, annotations }: Answering): AnsweredOnce {
  const answered = { kind: 'answered', fields: answeredFields(done, recording), durationMs, annotations } as const;
  const { outcome, message, retryAfterMs } = done;
  const answer = answerOf(recording.scrub(done.resultJson ?? ''));
  if (outcome === 'result') {
    return { ...answered, outcome, answer, detail: '', retryAfterMs };
  }
  const said = message === '' ? resultText(answer) : recording.scrub(message);
  return { ...answered, outcome, detail: cutToFailureBound(said), retryAfterMs };
}
