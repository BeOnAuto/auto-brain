import { Buffer } from 'node:buffer';

import type { CalledOnce, DeliveryCall, NotOfferedBecause, StartedFields, ToolAccess } from '@beonauto/mcp';
import { ToolNotOffered } from '@beonauto/mcp';
import { Effect, Result } from 'effect';

import { chatBoard, type BoardAnswer, type ChatBoard } from './chat-board.ts';

export type FakeAnswer =
  | BoardAnswer
  | { readonly kind: 'not_offered' }
  | { readonly kind: 'unopened'; readonly detail: string };

export type ToolPorts = Pick<ToolAccess, 'named' | 'configured' | 'startOf' | 'callOnce'>;

export interface FakeTools extends ToolPorts, Pick<ChatBoard, 'posted'> {
  readonly calls: () => readonly DeliveryCall[];
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

function refusalOf({ server, tool }: DeliveryCall['reference'], { disallowed }: Offering): Refusal | undefined {
  if (server !== 'chat') {
    return notConfigured(server);
  }
  return disallowed.has(tool) ? notAllowed(tool) : undefined;
}

function notOfferedBy({ because, detail }: Refusal): CalledOnce {
  return { kind: 'not_offered', because, detail };
}

function startOf({ reference, input }: Pick<DeliveryCall, 'reference' | 'input'>): StartedFields {
  const argumentsJson = JSON.stringify(input);
  return { ...reference, arguments_bytes: Buffer.byteLength(argumentsJson), arguments_sha256: digest };
}

function unsentBy(answer: Exclude<FakeAnswer, BoardAnswer>, { reference }: DeliveryCall): CalledOnce {
  return answer.kind === 'unopened'
    ? { kind: 'unopened', because: 'mcp_server_failed', detail: answer.detail }
    : notOfferedBy(notAllowed(reference.tool));
}

function answeredWith(answer: BoardAnswer, number: number): CalledOnce {
  const bytes = answer.outcome === 'result' ? Buffer.byteLength(JSON.stringify(answer.answer)) : null;
  const fields = { result_bytes: bytes, result_sha256: bytes === null ? null : digest, jsonrpc_id: number };
  return { ...answer, kind: 'answered', fields, durationMs: 3 };
}

function namedBy(refusals: readonly (Refusal | undefined)[]): Result.Result<void, ToolNotOffered> {
  const refusal = refusals.find((each) => each !== undefined);
  return refusal === undefined ? Result.void : Result.fail(new ToolNotOffered(refusal));
}

export function fakeTools(duringCall: () => Effect.Effect<unknown> = () => Effect.void): FakeTools {
  const board = chatBoard();
  const calls: DeliveryCall[] = [];
  const queued: FakeAnswer[] = [];
  const offering = { disallowed: new Set<string>() };
  const sent = (call: DeliveryCall): Effect.Effect<CalledOnce> => {
    const refusal = refusalOf(call.reference, offering);
    if (refusal !== undefined) {
      return Effect.succeed(notOfferedBy(refusal));
    }
    const next = queued.shift() ?? board.answerOf(call);
    if ('kind' in next) {
      return Effect.succeed(unsentBy(next, call));
    }
    calls.push(call);
    return Effect.as(duringCall(), answeredWith(next, calls.length));
  };
  return {
    configured: true,
    named: (_address, references) => namedBy(references.map((reference) => refusalOf(reference, offering))),
    startOf,
    callOnce: sent,
    calls: () => [...calls],
    posted: board.posted,
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
