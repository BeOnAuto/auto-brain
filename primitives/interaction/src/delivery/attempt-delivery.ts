import { Clock, Effect, type Schema } from 'effect';

import type { Channel } from '../channels/channel-settings.ts';
import type { DeliveryParts, DueRequest } from '../schedule/delivery-parts.ts';
import { endedAs, type AttemptEnd } from './attempt-end.ts';
import { deliveredByTool } from './mcp-delivery.ts';
import { deliveredByWebhook } from './webhook-delivery.ts';

export function attemptOf(
  parts: DeliveryParts,
  channel: Channel | undefined,
  request: DueRequest,
  answerSchema: Schema.JsonObject | undefined,
): Effect.Effect<AttemptEnd> {
  if (channel === undefined) {
    return Effect.succeed(endedAs({ outcome: 'failed', because: 'channel_not_offered' }));
  }
  const { address, row } = request;
  if (channel.type === 'mcp') {
    return deliveredByTool({ channel, address, row, answerSchema, tools: parts.tools });
  }
  return Effect.flatMap(Clock.currentTimeMillis, (nowMs) =>
    Effect.promise(() =>
      deliveredByWebhook({
        channel,
        address,
        row,
        answerSchema,
        origin: parts.origin,
        nowMs,
        ...(parts.fetch === undefined ? {} : { fetch: parts.fetch }),
      }),
    ),
  );
}
