import { DateTime, Effect, Schema } from 'effect';

import { notListed } from '../access/tool-naming.ts';
import { toolBounds } from '../bounds/call-bounds.ts';
import type { CallReply } from '../calls/call-replies.ts';
import type { OfferedTool, RunTools } from '../calls/run-tools.ts';
import { ignored } from '../connections/ignored.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { unavailableOf } from '../tool-reads/tool-refusals.ts';
import { CalledOutcomeSchema, type CalledOutcome } from './execute-schemas.ts';

export interface HandCall {
  readonly reference: ToolReference;
  readonly callId: string;
  readonly input: Schema.JsonObject;
}

export interface Calling {
  readonly calledAt: string;
  readonly answering: Promise<CallReply>;
  readonly replying: Promise<CallReply>;
  readonly stop: AbortController;
}

const isCalledOutcome = Schema.is(CalledOutcomeSchema);

export function calledOutcomeOf({ outcome }: CallReply): Effect.Effect<CalledOutcome> {
  return isCalledOutcome(outcome)
    ? Effect.succeed(outcome)
    : Effect.die(new Error(`A call made by hand answered ${outcome}, which a call that was sent never answers`));
}

async function closedOnceAnswered(tools: RunTools, answering: Promise<CallReply>): Promise<CallReply> {
  try {
    return await answering;
  } finally {
    await tools.close();
  }
}

function startedCall(tools: RunTools, offered: OfferedTool, { callId, input }: HandCall, calledAt: string): Calling {
  const stop = new AbortController();
  const answering = offered.call(
    { callId, input, room: toolBounds.executedAnswerBytes },
    { signal: stop.signal, cancelled: stop.signal },
  );
  const replying = closedOnceAnswered(tools, answering);
  replying.catch(ignored);
  return { calledAt, answering, replying, stop };
}

export function stopped({ stop, answering }: Calling): Effect.Effect<void> {
  return Effect.sync(() => {
    stop.abort();
  }).pipe(Effect.andThen(Effect.promise(() => answering)), Effect.asVoid);
}

export const calledOn = Effect.fnUntraced(function* (tools: RunTools, called: HandCall) {
  const [offered] = tools.offered;
  if (offered === undefined) {
    yield* Effect.promise(() => tools.close());
    return yield* Effect.fail(unavailableOf(notListed([called.reference])));
  }
  const calledAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.sync(() => startedCall(tools, offered, called, calledAt));
});
