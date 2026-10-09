import { toolBounds, type ToolAccess, type ToolNotOffered } from '@beonauto/mcp';
import type { ToolReference } from '@beonauto/mcp/policy';
import { Unavailable, type BrainAddress, type Conflict } from '@beonauto/operations';
import { Effect, Result, type Schema } from 'effect';

import { deliveryVariablesOf, renderedArguments, type ArgumentsFailure } from '../route/rendered-arguments.ts';
import type { RequestRecord } from './request-record.ts';
import { unworkable } from './request-rendering.ts';

export interface InteractionPorts {
  readonly tools: Pick<ToolAccess, 'named' | 'configured'>;
  readonly openRequests: (brain: BrainAddress) => Effect.Effect<number>;
  readonly mostOpenRequests: number;
}

export function offered(
  tools: readonly ToolReference[],
  ports: InteractionPorts,
  brain: BrainAddress,
): Effect.Effect<void, Unavailable> {
  return Result.match(ports.tools.named(brain, tools), {
    onSuccess: () => Effect.void,
    onFailure: ({ because, detail }: Pick<ToolNotOffered, 'because' | 'detail'>) =>
      Effect.fail(new Unavailable({ detail, kind: 'tool_not_offered', because })),
  });
}

export function roomFor(ports: InteractionPorts, brain: BrainAddress): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(ports.openRequests(brain), (open) =>
    open < ports.mostOpenRequests
      ? Effect.void
      : Effect.fail(
          new Unavailable({
            detail: `The brain holds ${open} open requests, the most it may; one must be answered, expire or be cancelled before another is asked`,
            kind: 'requests_full',
          }),
        ),
  );
}

const argumentWords = {
  not_text: 'renders a value that is not text for this request',
  too_long: `renders more than the ${toolBounds.argumentBytes} bytes a call may send for this request`,
  missing_variable: 'reads what this request does not have',
  limit_exceeded: 'cannot be rendered for this request',
  failed: 'cannot be rendered for this request',
} as const;

function argumentsRefusal(failure: ArgumentsFailure): Conflict {
  return failure.reason === 'too_large'
    ? unworkable(
        '/deliver/with',
        `The arguments of the call that delivers the request take ${failure.bytes} bytes, more than the ${toolBounds.argumentBytes} a call may send`,
      )
    : unworkable(
        `/deliver/with/${failure.argument}`,
        `The argument ${failure.argument} of the call that delivers the request ${argumentWords[failure.failure.reason]}`,
      );
}

export interface Asking {
  readonly input: Schema.Json;
  readonly runId: string;
  readonly functionName: string;
}

export function checkedArguments(record: RequestRecord, asking: Asking): Effect.Effect<void, Conflict> {
  if (record.deliver === undefined) {
    return Effect.void;
  }
  return Result.match(renderedArguments(record.deliver.with, deliveryVariablesOf(record, asking)), {
    onSuccess: () => Effect.void,
    onFailure: (failure) => Effect.fail(argumentsRefusal(failure)),
  });
}
