import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@beonauto/definitions';
import type { Conflict, InvalidInput } from '@beonauto/operations';
import { Clock, Effect, type Schema } from 'effect';

import type { RequestDocument } from '../document/interaction-document.ts';
import { momentVariables } from '../tool-blocks/rendered-arguments.ts';
import { routeOf, toolsOf } from '../tool-blocks/routes.ts';
import { checkedArguments, offered, roomFor, type InteractionPorts } from './request-reach.ts';
import type { RequestRecord } from './request-record.ts';
import { checkedAnswerer, checkedParty, fromPart, messagePart, renderedPart, toPart } from './request-rendering.ts';
import { preparedInput } from './run-input.ts';

type Variables = Readonly<Record<string, Schema.Json>>;

function answeringOf(
  document: RequestDocument,
  variables: Variables,
  to: string,
): Effect.Effect<Pick<RequestRecord, 'answerer' | 'reply'>, Conflict | InvalidInput> {
  const answerer =
    document.from === undefined
      ? Effect.succeed(to)
      : Effect.flatMap(renderedPart({ ...fromPart, template: document.from }, variables), checkedAnswerer);
  return Effect.map(answerer, (party) => ({
    answerer: party,
    ...(document.reply === undefined ? {} : { reply: document.reply }),
  }));
}

function requestOf(
  document: RequestDocument,
  input: Schema.Json,
): Effect.Effect<RequestRecord, Conflict | InvalidInput> {
  return Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const now = new Date(at).toISOString();
    const variables = momentVariables(input, now);
    const to = yield* Effect.flatMap(renderedPart({ ...toPart, template: document.to }, variables), checkedParty);
    const message = yield* renderedPart({ ...messagePart, template: document.message }, variables);
    const answerSchema = document.output.schema?.document;
    const answering =
      answerSchema === undefined
        ? {}
        : { answer_schema: answerSchema, ...(yield* answeringOf(document, variables, to)) };
    const { route } = document;
    return {
      to,
      message,
      ...answering,
      expires_at: new Date(at + document.expiresMs).toISOString(),
      requested_at: now,
      ...(route === undefined ? {} : { deliver: route.deliver }),
      ...(route?.replies === undefined ? {} : { replies: route.replies }),
    };
  });
}

export function asksLater(document: RequestDocument): boolean {
  return document.route !== undefined || document.output.schema !== undefined;
}

export function requestRun(ports: InteractionPorts) {
  return (
    document: RequestDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<CapabilityAnswer, CapabilityRejection> =>
    Effect.gen(function* () {
      const admitted = yield* preparedInput(input, document.input);
      const brain = { org: context.org, brain: context.brain };
      yield* offered(toolsOf(routeOf(document.route ?? {})), ports, brain);
      if (!asksLater(document)) {
        const notified = yield* requestOf(document, admitted);
        return { output: {}, record: notified };
      }
      yield* roomFor(ports, brain);
      const record = yield* requestOf(document, admitted);
      yield* checkedArguments(record, { input: admitted, runId: context.id, functionName: context.definition.name });
      return { finishesLater: true, record };
    });
}
