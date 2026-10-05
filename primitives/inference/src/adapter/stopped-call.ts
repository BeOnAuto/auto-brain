import { clearTimeout, setTimeout } from 'node:timers';

import { Cancelled } from '../failure/cancelled.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import { TimedOut } from '../failure/timed-out.ts';
import { ToolsStopped } from '../failure/tools-stopped.ts';
import type { ModelRequest, ModelTools } from '../model/model-request.ts';

interface Deadline {
  readonly signal: AbortSignal;
  readonly ms: number;
}

export interface StepDeadline {
  readonly signal: AbortSignal;
  readonly started: () => void;
  readonly ended: () => void;
}

export interface Deadlines {
  readonly whole: Deadline | undefined;
  readonly step: StepDeadline;
  readonly stepMissed: () => Deadline | undefined;
}

function deadline(ms: number): Deadline {
  return { signal: AbortSignal.timeout(ms), ms };
}

function untimed(): void {}

function neverMissed(): undefined {}

const noStepDeadline: StepDeadline = { signal: new AbortController().signal, started: untimed, ended: untimed };

function stepDeadlines(ms: number) {
  const missed = new AbortController();
  const timer: { current?: NodeJS.Timeout } = {};
  const step: StepDeadline = {
    signal: missed.signal,
    started: () => {
      timer.current = setTimeout(() => {
        missed.abort();
      }, ms).unref();
    },
    ended: () => {
      clearTimeout(timer.current);
    },
  };
  return { step, stepMissed: () => (missed.signal.aborted ? { signal: missed.signal, ms } : undefined) };
}

export function deadlinesOf({ timeout_ms: ms, tools }: ModelRequest): Deadlines {
  if (tools === undefined) {
    const whole = ms === undefined ? undefined : deadline(ms);
    return { whole, step: noStepDeadline, stepMissed: () => (whole?.signal.aborted === true ? whole : undefined) };
  }
  const whole = deadline(tools.runBoundMs);
  return ms === undefined ? { whole, step: noStepDeadline, stepMissed: neverMissed } : { whole, ...stepDeadlines(ms) };
}

function toolsStopped(provider: string, tools: ModelTools, whole: Deadline | undefined): ModelFailure | undefined {
  if (whole?.signal.aborted === true) {
    return new ToolsStopped({
      detail: `The run went on for ${whole.ms} ms, the longest a run that calls tools may take`,
      provider,
      because: 'run_bound',
    });
  }
  return tools.ended.aborted
    ? new ToolsStopped({ detail: 'Its tool servers failed too often', provider, because: 'server_failed' })
    : undefined;
}

export function stoppedFailure(
  provider: string,
  request: ModelRequest,
  deadlines: Deadlines,
): ModelFailure | undefined {
  const missed = deadlines.stepMissed();
  if (missed !== undefined) {
    return new TimedOut({
      detail: `${provider} did not answer within ${missed.ms} ms`,
      provider,
      timeout_ms: missed.ms,
    });
  }
  const stopped = request.tools === undefined ? undefined : toolsStopped(provider, request.tools, deadlines.whole);
  if (stopped !== undefined) {
    return stopped;
  }
  return request.signal?.aborted === true
    ? new Cancelled({ detail: `The call to ${provider} was cancelled`, provider })
    : undefined;
}
