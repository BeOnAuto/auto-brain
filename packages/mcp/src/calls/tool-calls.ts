import { setTimeout } from 'node:timers/promises';

import { toolBounds } from '../bounds/call-bounds.ts';
import { metaValueOf, type ToolAnswer, type ToolResult } from '../bounds/tool-results.ts';
import { ignored } from '../connections/ignored.ts';
import type { Observed } from '../connections/observed-requests.ts';
import { failureOf, type FailureKind } from '../connections/server-failures.ts';
import type { CallFailedBecause } from './call-facts.ts';
import type { ServerSlot } from './server-slot.ts';

export type ForwardedOutcome = 'result' | 'tool_error' | CallFailedBecause;

export interface Forwarding {
  readonly slot: ServerSlot;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly callMs: number;
  readonly longestRetryWaitMs: number;
  readonly signal: Readonly<AbortSignal>;
}

interface ForwardedCall {
  readonly message: string;
  readonly failure: FailureKind | null;
  readonly jsonrpcId: string | number | null;
  readonly serverRequestId: string | null;
  readonly retryAfterMs: number | null;
}

export interface AnsweredCall extends ForwardedCall {
  readonly outcome: 'result' | 'tool_error';
  readonly result: ToolResult;
  readonly resultJson: string;
}

export interface FailedCall extends ForwardedCall {
  readonly outcome: CallFailedBecause;
  readonly result: null;
  readonly resultJson: null;
}

export type Forwarded = AnsweredCall | FailedCall;

export interface ScrubbedAnswer extends AnsweredCall {
  readonly scrubbed: ToolAnswer;
}

export type Delivered = ScrubbedAnswer | FailedCall;

interface Attempt {
  readonly deadline: Readonly<AbortSignal>;
  readonly waitedMs: number;
}

const unobserved: Observed = { id: null, response: null };

const tooLargeWords = `The MCP server answered more than the ${toolBounds.httpAnswerBytes} bytes one call may take`;

function requestIdOf(forwarding: Forwarding, observed: Observed, result: ToolResult): string | null {
  const key = forwarding.slot.settings.request_id;
  if (key === null) {
    return null;
  }
  const carried: unknown = observed.response?.serverRequestId ?? metaValueOf(result, key);
  return typeof carried === 'string' ? carried : null;
}

function failed(
  outcome: CallFailedBecause,
  failure: FailureKind | null,
  message: string,
  observed: Observed,
): FailedCall {
  return {
    outcome,
    result: null,
    resultJson: null,
    message,
    failure,
    jsonrpcId: observed.id,
    serverRequestId: null,
    retryAfterMs: observed.response?.retryAfterMs ?? null,
  };
}

interface Answered {
  readonly result: ToolResult;
  readonly resultJson: string;
  readonly observed: Observed;
}

function answered(forwarding: Forwarding, { result, resultJson, observed }: Answered): AnsweredCall {
  return {
    outcome: result.isError === true ? 'tool_error' : 'result',
    result,
    resultJson,
    message: '',
    failure: null,
    jsonrpcId: observed.id,
    serverRequestId: requestIdOf(forwarding, observed, result),
    retryAfterMs: null,
  };
}

function stopped(forwarding: Forwarding, { deadline }: Attempt, observed: Observed): Forwarded | undefined {
  if (deadline.aborted) {
    return failed('timed_out', 'timed_out', `The MCP server did not answer within ${forwarding.callMs} ms`, observed);
  }
  return forwarding.signal.aborted
    ? failed('cancelled', null, 'The call was cancelled because the run ended', observed)
    : undefined;
}

async function retried(
  forwarding: Forwarding,
  kind: FailureKind,
  observed: Observed,
  attempt: Attempt,
): Promise<Attempt | undefined> {
  const waitMs = observed.response?.retryAfterMs ?? Number.POSITIVE_INFINITY;
  if (kind === 'rate_limited' && attempt.waitedMs + waitMs <= forwarding.longestRetryWaitMs) {
    await setTimeout(waitMs, undefined, { signal: forwarding.signal }).catch(ignored);
    return { ...attempt, waitedMs: attempt.waitedMs + waitMs };
  }
  return kind === 'forgotten' && (await forwarding.slot.reopenOnce().catch(ignored)) === true ? attempt : undefined;
}

function settledFailure(kind: FailureKind, message: string, observed: Observed): Forwarded {
  return kind === 'refused'
    ? failed('arguments_refused', null, message, observed)
    : failed('server_failure', kind, message, observed);
}

async function attempted(forwarding: Forwarding, attempt: Attempt): Promise<Forwarded> {
  const settled = await forwarding.slot.connection().call({
    tool: forwarding.tool,
    input: forwarding.input,
    meta: forwarding.meta,
    signal: AbortSignal.any([forwarding.signal, attempt.deadline]),
    timeoutMs: forwarding.callMs,
  });
  if ('result' in settled) {
    return answered(forwarding, settled);
  }
  if (settled.observed.response?.tooLarge === true) {
    return failed('server_failure', 'too_large', tooLargeWords, settled.observed);
  }
  const halted = stopped(forwarding, attempt, settled.observed);
  if (halted !== undefined) {
    return halted;
  }
  const { kind, message } = failureOf(settled.error);
  const next = await retried(forwarding, kind, settled.observed, attempt);
  return next === undefined ? settledFailure(kind, message, settled.observed) : attempted(forwarding, next);
}

async function restarted(slot: ServerSlot): Promise<Forwarded | undefined> {
  const restart = await slot.restartIfExited().catch((error: unknown) => failureOf(error));
  if (restart === 'exited_again') {
    return failed(
      'server_failure',
      'closed',
      'The MCP server process exited again after its restart in this run',
      unobserved,
    );
  }
  return typeof restart === 'string' ? undefined : failed('server_failure', restart.kind, restart.message, unobserved);
}

export async function forwarded(forwarding: Forwarding): Promise<Forwarded> {
  const exited = await restarted(forwarding.slot);
  return exited ?? attempted(forwarding, { deadline: AbortSignal.timeout(forwarding.callMs), waitedMs: 0 });
}
