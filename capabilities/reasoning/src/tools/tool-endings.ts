import type { RunTools } from '@beonauto/mcp';
import { Unavailable, type UnavailableBecause } from '@beonauto/operations';
import { Effect, type Schema } from 'effect';

import type { ToolsStoppedBecause } from '../failure/tools-stopped.ts';
import type { TokenUsage } from '../model/model-result.ts';

type UnfinishedBecause = Extract<UnavailableBecause, 'server_failed' | 'model_unavailable' | 'run_bound' | 'no_answer'>;

const serverEndings = {
  failing: 'A tool server kept failing',
  rate_limited: 'A tool server kept asking the run to slow down for longer than it waits',
} as const;

export interface Spent {
  readonly record?: Schema.JsonObject;
}

function unfinished(tools: RunTools, because: UnfinishedBecause, detail: string, spent: Spent): Unavailable {
  return new Unavailable({
    detail: `${detail}, after the run called ${tools.usedInWords()}`,
    kind: 'tools_unfinished',
    because,
    ...spent,
  });
}

export interface Stopped {
  readonly detail: string;
  readonly because: ToolsStoppedBecause;
  readonly usage?: TokenUsage;
}

function stoppedDetail(tools: RunTools, stopped: Stopped): string {
  const ending = tools.ending();
  return ending === undefined ? stopped.detail : serverEndings[ending.because];
}

export function stoppedEnding(
  tools: RunTools | undefined,
  stopped: Stopped,
  spent: Spent = {},
): Effect.Effect<never, Unavailable> {
  return Effect.fail(
    tools?.calledAny() === true
      ? unfinished(tools, stopped.because, stoppedDetail(tools, stopped), spent)
      : new Unavailable({ detail: stopped.detail, ...spent }),
  );
}

export function unavailableAfter(
  tools: RunTools | undefined,
  detail: string,
  advice: string,
  spent: Spent = {},
): Effect.Effect<never, Unavailable> {
  return Effect.fail(
    tools?.calledAny() === true
      ? unfinished(tools, 'model_unavailable', detail, spent)
      : new Unavailable({ detail: `${detail}${advice}`, ...spent }),
  );
}
