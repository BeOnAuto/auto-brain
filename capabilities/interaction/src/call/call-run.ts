import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@beonauto/definitions';
import { toolBounds, type ToolAccess } from '@beonauto/mcp';
import { runIdKey } from '@beonauto/mcp/policy';
import type { Conflict, InvalidInput } from '@beonauto/operations';
import { Clock, Effect, Result, type Schema } from 'effect';

import type { CallDocument } from '../document/interaction-document.ts';
import { unrenderableFor, unworkable } from '../run/request-rendering.ts';
import { preparedInput } from '../run/run-input.ts';
import { momentVariables, renderedArguments, type ArgumentsFailure } from '../tool-blocks/rendered-arguments.ts';
import { endingOf } from './call-endings.ts';

export const longestCallRunMs = 4 * toolBounds.openMs + toolBounds.callMs;

export interface CallPorts {
  readonly tools: Pick<ToolAccess, 'callOnce'>;
}

function argumentsRejection(failure: ArgumentsFailure): Conflict | InvalidInput {
  if (failure.reason === 'too_large') {
    return unworkable(
      '/call/with',
      `The arguments of the call take ${failure.bytes} bytes, more than the ${toolBounds.argumentBytes} a call may send`,
    );
  }
  const { argument, failure: rendering } = failure;
  const pointer = `/call/with/${argument}`;
  if (rendering.reason === 'not_text') {
    return unworkable(
      pointer,
      `The argument ${argument} of the call renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is`,
    );
  }
  return rendering.reason === 'too_long'
    ? unworkable(
        pointer,
        `The argument ${argument} of the call renders more than the ${toolBounds.argumentBytes} bytes a call may send`,
      )
    : unrenderableFor(`The argument ${argument} of the call`, rendering);
}

function argumentsOf(
  { call }: CallDocument,
  variables: Readonly<Record<string, Schema.Json>>,
): Effect.Effect<Readonly<Record<string, Schema.Json>>, Conflict | InvalidInput> {
  return Result.match(renderedArguments(call.with ?? {}, variables), {
    onSuccess: ({ input }) => Effect.succeed(input),
    onFailure: (failure) => Effect.fail(argumentsRejection(failure)),
  });
}

export function callRun(ports: CallPorts) {
  return (
    document: CallDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<CapabilityAnswer, CapabilityRejection> =>
    Effect.gen(function* () {
      const admitted = yield* preparedInput(input, document.input);
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      const rendered = yield* argumentsOf(document, momentVariables(admitted, at));
      const { server, tool } = document.call;
      const called = yield* ports.tools.callOnce(
        {
          org: context.org,
          brain: context.brain,
          reference: { server, tool },
          input: rendered,
          meta: { [runIdKey]: context.id },
          longestRetryWaitMs: toolBounds.longestRetryWaitMs,
        },
        { callId: context.id, journal: context.journal },
      );
      return yield* endingOf(document, called);
    });
}
