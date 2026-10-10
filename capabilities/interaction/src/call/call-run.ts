import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@beonauto/definitions';
import { toolBounds, type ToolAccess } from '@beonauto/mcp';
import { runIdKey } from '@beonauto/mcp/policy';
import type { Conflict, InvalidInput } from '@beonauto/operations';
import { Clock, Effect, Result, type Schema } from 'effect';

import type { CallDocument } from '../document/interaction-document.ts';
import { unrenderableFor, unworkable } from '../run/request-rendering.ts';
import { preparedInput } from '../run/run-input.ts';
import {
  argumentsFailureWords,
  momentVariables,
  renderedArguments,
  type ArgumentsFailure,
} from '../tool-blocks/rendered-arguments.ts';
import { endingOf } from './call-endings.ts';

export const longestCallRunMs = 4 * toolBounds.openMs + toolBounds.callMs;

export interface CallPorts {
  readonly tools: Pick<ToolAccess, 'callOnce'>;
}

function argumentsRejection(failure: ArgumentsFailure): Conflict | InvalidInput {
  if (failure.reason === 'too_large') {
    return unworkable('/call/with', argumentsFailureWords(failure, 'the call'));
  }
  const { argument, failure: rendering } = failure;
  return rendering.reason === 'not_text' || rendering.reason === 'too_long'
    ? unworkable(`/call/with/${argument}`, argumentsFailureWords(failure, 'the call'))
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
