import type { Conflict, InvalidInput } from '@beonauto/operations';
import type { Executed, PrimitiveRejection, RunContext } from '@beonauto/specs';
import { Clock, Effect, type Schema } from 'effect';

import { inboxChannel } from '../channels/channel-names.ts';
import type { InteractionFunctionDefinitionDocument } from '../document/interaction-document.ts';
import { checkedArguments, partyRuleOf, reachOf, roomFor, type InteractionPorts, type Reach } from './request-reach.ts';
import type { RequestRecord } from './request-record.ts';
import { checkedParty, messagePart, renderedPart, toPart } from './request-rendering.ts';
import { preparedInput } from './run-input.ts';

function requestOf(
  document: InteractionFunctionDefinitionDocument,
  reach: Reach,
  input: Schema.Json,
): Effect.Effect<RequestRecord, Conflict | InvalidInput> {
  return Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const now = new Date(at).toISOString();
    const variables = { input, today: now.slice(0, 10), now };
    const to = yield* Effect.flatMap(renderedPart({ ...toPart, template: document.to }, variables), (party) =>
      checkedParty(party, partyRuleOf(reach)),
    );
    const message = yield* renderedPart({ ...messagePart, template: document.message }, variables);
    const answerSchema = document.output.schema?.document;
    return {
      channel: document.channel,
      to,
      message,
      ...(answerSchema === undefined ? {} : { answer_schema: answerSchema }),
      expires_at: new Date(at + document.expiresMs).toISOString(),
    };
  });
}

export function finishesLater(document: InteractionFunctionDefinitionDocument): boolean {
  return document.channel !== inboxChannel || document.output.schema !== undefined;
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
      const reach = yield* reachOf(document.channel, ports, brain);
      if (!finishesLater(document)) {
        const notified = yield* requestOf(document, reach, admitted);
        return { output: {}, record: notified };
      }
      yield* roomFor(ports, brain);
      const record = yield* requestOf(document, reach, admitted);
      yield* checkedArguments(reach, record, context);
      return { finishesLater: true, record };
    });
}
