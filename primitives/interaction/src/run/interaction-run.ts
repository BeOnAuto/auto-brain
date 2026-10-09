import type { Conflict, InvalidInput } from '@beonauto/operations';
import type { Executed, PrimitiveRejection, RunContext } from '@beonauto/specs';
import { Clock, Effect, type Schema } from 'effect';

import type { InteractionFunctionDefinitionDocument } from '../document/interaction-document.ts';
import { routeOf, toolsOf } from '../route/routes.ts';
import { checkedArguments, offered, roomFor, type InteractionPorts } from './request-reach.ts';
import type { RequestRecord } from './request-record.ts';
import { checkedAnswerer, checkedParty, fromPart, messagePart, renderedPart, toPart } from './request-rendering.ts';
import { preparedInput } from './run-input.ts';

type Variables = Readonly<Record<string, Schema.Json>>;

function answeringOf(
  document: InteractionFunctionDefinitionDocument,
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
  document: InteractionFunctionDefinitionDocument,
  input: Schema.Json,
): Effect.Effect<RequestRecord, Conflict | InvalidInput> {
  return Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const now = new Date(at).toISOString();
    const variables = { input, today: now.slice(0, 10), now };
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

export function finishesLater(document: InteractionFunctionDefinitionDocument): boolean {
  return document.route !== undefined || document.output.schema !== undefined;
}

export function interactionRun(ports: InteractionPorts) {
  return (
    document: InteractionFunctionDefinitionDocument,
    input: Schema.Json,
    context: RunContext,
  ): Effect.Effect<Executed, PrimitiveRejection> =>
    Effect.gen(function* () {
      const admitted = yield* preparedInput(input, document.input);
      const brain = { org: context.org, brain: context.brain };
      yield* offered(toolsOf(routeOf(document.route ?? {})), ports, brain);
      if (!finishesLater(document)) {
        const notified = yield* requestOf(document, admitted);
        return { output: {}, record: notified };
      }
      yield* roomFor(ports, brain);
      const record = yield* requestOf(document, admitted);
      yield* checkedArguments(record, { input: admitted, runId: context.id, functionName: context.spec.name });
      return { finishesLater: true, record };
    });
}
