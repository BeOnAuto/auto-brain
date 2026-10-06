import type { RunTools } from '@beonauto/mcp';
import { Unavailable, type UnavailableBecause } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ToolsStoppedBecause } from '../failure/tools-stopped.ts';

type UnfinishedBecause = Extract<UnavailableBecause, 'server_failed' | 'model_unavailable' | 'run_bound' | 'no_answer'>;

const serverEndings = {
  failing: 'A tool server kept failing',
  rate_limited: 'A tool server kept asking the run to slow down for longer than it waits',
} as const;

function unfinished(tools: RunTools, because: UnfinishedBecause, detail: string): Unavailable {
  return new Unavailable({
    detail: `${detail}, after the run called ${tools.usedInWords()}`,
    kind: 'tools_unfinished',
    because,
  });
}

export interface Stopped {
  readonly detail: string;
  readonly because: ToolsStoppedBecause;
}

function stoppedDetail(tools: RunTools, stopped: Stopped): string {
  const ending = tools.ending();
  return ending === undefined ? stopped.detail : serverEndings[ending.because];
}

export function stoppedEnding(tools: RunTools | undefined, stopped: Stopped): Effect.Effect<never, Unavailable> {
  return Effect.fail(
    tools?.calledAny() === true
      ? unfinished(tools, stopped.because, stoppedDetail(tools, stopped))
      : new Unavailable({ detail: stopped.detail }),
  );
}

export function unavailableAfter(
  tools: RunTools | undefined,
  detail: string,
  advice: string,
): Effect.Effect<never, Unavailable> {
  return Effect.fail(
    tools?.calledAny() === true
      ? unfinished(tools, 'model_unavailable', detail)
      : new Unavailable({ detail: `${detail}${advice}` }),
  );
}
