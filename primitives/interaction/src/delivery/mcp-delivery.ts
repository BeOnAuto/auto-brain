import type { DeliveryCallEnded, ToolAccess } from '@beonauto/mcp';
import { deliveryIdKey, executionIdKey } from '@beonauto/mcp/policy';
import { Effect, Result, type Schema } from 'effect';

import { renderedArguments } from '../channels/channel-arguments.ts';
import type { McpChannel } from '../channels/channel-settings.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import { endedAs, type AttemptEnd, type RequestAddress } from './attempt-end.ts';
import { endOfCall } from './call-ends.ts';

export interface McpAttempt {
  readonly channel: McpChannel;
  readonly address: RequestAddress;
  readonly row: OpenRequestRow;
  readonly answerSchema: Schema.JsonObject | undefined;
  readonly tools: Pick<ToolAccess, 'callOnce'>;
}

function endOf(ended: DeliveryCallEnded): AttemptEnd {
  const end = endOfCall(ended);
  if ('answered' in end) {
    return endedAs({ outcome: 'delivered', response_bytes: end.answered.bytes });
  }
  const { because, retryAfterMs, detail } = end.failed;
  return endedAs({
    outcome: 'failed',
    because,
    ...(retryAfterMs === null ? {} : { retry_after_ms: retryAfterMs }),
    ...(detail === '' ? {} : { detail }),
  });
}

export function deliveredByTool({ channel, address, row, answerSchema, tools }: McpAttempt): Effect.Effect<AttemptEnd> {
  const fields = {
    to: row.party,
    message: row.message,
    run_id: address.id,
    function: row.function,
    expires_at: new Date(row.expires_at).toISOString(),
    answer_schema: answerSchema ?? null,
  };
  return Result.match(renderedArguments(channel.with, fields), {
    onFailure: () => Effect.succeed(endedAs({ outcome: 'refused', because: 'too_large' })),
    onSuccess: ({ input }) =>
      Effect.map(
        tools.callOnce({
          org: address.org,
          brain: address.brain,
          reference: { server: channel.server, tool: channel.tool },
          input,
          meta: { [executionIdKey]: address.id, [deliveryIdKey]: row.request_id },
        }),
        endOf,
      ),
  });
}
