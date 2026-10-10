import { Buffer } from 'node:buffer';

import type { AnsweredOnce, CalledOnce, NotOfferedBecause, OneCall, StartedFields, ToolAccess } from '@beonauto/mcp';
import { ToolNotOffered } from '@beonauto/mcp';
import { Effect, Result } from 'effect';

import { chatBoard, type BoardAnswer, type ChatBoard } from './chat-board.ts';

export type FakeAnswer =
  | BoardAnswer
  | { readonly kind: 'not_offered' }
  | { readonly kind: 'unopened'; readonly detail: string };

export type ToolPorts = Pick<ToolAccess, 'named' | 'configured' | 'startOf' | 'callOnce'>;

export interface FakeTools extends ToolPorts, Pick<ChatBoard, 'posted' | 'reply'> {
  readonly calls: () => readonly OneCall[];
  readonly answerNext: (...answers: readonly FakeAnswer[]) => void;
  readonly disallow: (tool: string) => void;
}

interface Refusal {
  readonly because: NotOfferedBecause;
  readonly detail: string;
}

const digest = 'd'.repeat(64);

function notAllowed(tool: string): Refusal {
  return { because: 'tool_not_allowed', detail: `The operator of this server does not allow chat/${tool}` };
}

function notConfigured(server: string): Refusal {
  return { because: 'mcp_server_not_configured', detail: `No MCP server named ${server} is configured for this brain` };
}

interface Offering {
  readonly disallowed: ReadonlySet<string>;
}

function refusalOf({ server, tool }: OneCall['reference'], { disallowed }: Offering): Refusal | undefined {
  if (server !== 'chat') {
    return notConfigured(server);
  }
  return disallowed.has(tool) ? notAllowed(tool) : undefined;
}

function notOfferedBy(refusal: Refusal): CalledOnce {
  return { kind: 'unopened', refused: 'tool_not_offered', ...refusal };
}

function startOf({ reference, input }: Pick<OneCall, 'reference' | 'input'>): Effect.Effect<StartedFields> {
  const argumentsJson = JSON.stringify(input);
  return Effect.succeed({
    ...reference,
    arguments_bytes: Buffer.byteLength(argumentsJson),
    arguments_sha256: digest,
    content_kept: true,
  });
}

function unsentBy(answer: Exclude<FakeAnswer, BoardAnswer>, { reference }: OneCall): CalledOnce {
  return answer.kind === 'unopened'
    ? { kind: 'unopened', refused: 'mcp_server_failed', because: 'failing', detail: answer.detail }
    : notOfferedBy(notAllowed(reference.tool));
}

function answeredOf(bytes: number, isError: boolean, number: number) {
  return {
    is_error: isError,
    result_bytes: bytes,
    result_sha256: digest,
    content_kept: true,
    duration_ms: 3,
    jsonrpc_id: number,
  };
}

function answeredWith(answer: BoardAnswer, number: number): AnsweredOnce {
  const { detail, retryAfterMs } = answer;
  const answering = { kind: 'answered', annotations: undefined, detail, retryAfterMs } as const;
  if (answer.outcome === 'result') {
    const bytes = Buffer.byteLength(JSON.stringify(answer.answer));
    return { ...answering, outcome: 'result', answer: answer.answer, answered: answeredOf(bytes, false, number) };
  }
  const { outcome } = answer;
  if (outcome === 'tool_error') {
    return { ...answering, outcome, answered: answeredOf(0, true, number) };
  }
  return { ...answering, outcome, failed: { because: outcome, duration_ms: 3, jsonrpc_id: number } };
}

function namedBy(refusals: readonly (Refusal | undefined)[]): Result.Result<void, ToolNotOffered> {
  const refusal = refusals.find((each) => each !== undefined);
  return refusal === undefined ? Result.void : Result.fail(new ToolNotOffered(refusal));
}

export function fakeTools(duringCall: (call: OneCall) => Effect.Effect<unknown> = () => Effect.void): FakeTools {
  const board = chatBoard();
  const calls: OneCall[] = [];
  const queued: FakeAnswer[] = [];
  const offering = { disallowed: new Set<string>() };
  const sent = (call: OneCall): Effect.Effect<CalledOnce> => {
    const refusal = refusalOf(call.reference, offering);
    if (refusal !== undefined) {
      return Effect.succeed(notOfferedBy(refusal));
    }
    const next = queued.shift() ?? board.answerOf(call);
    if ('kind' in next) {
      return Effect.succeed(unsentBy(next, call));
    }
    calls.push(call);
    return Effect.as(duringCall(call), answeredWith(next, calls.length));
  };
  return {
    configured: true,
    named: (_address, references) => namedBy(references.map((reference) => refusalOf(reference, offering))),
    startOf,
    callOnce: sent,
    calls: () => [...calls],
    posted: board.posted,
    reply: board.reply,
    answerNext: (...answers) => {
      queued.push(...answers);
    },
    disallow: (tool) => {
      offering.disallowed.add(tool);
    },
  };
}

export const noTools: ToolPorts = {
  configured: false,
  named: (_address, references) => namedBy(references.map(({ server }) => notConfigured(server))),
  startOf,
  callOnce: ({ reference }) => Effect.succeed(notOfferedBy(notConfigured(reference.server))),
};
