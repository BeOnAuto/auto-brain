import type { DeliveryCallEnded, ToolAccess } from '@beonauto/mcp';
import { Effect, Result, type Schema } from 'effect';

import { renderedArguments } from '../channels/channel-arguments.ts';
import type { McpChannel } from '../channels/channel-settings.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import { endedAs, type AttemptEnd, type RequestAddress } from './attempt-end.ts';

export interface McpAttempt {
  readonly channel: McpChannel;
  readonly address: RequestAddress;
  readonly row: OpenRequestRow;
  readonly answerSchema: Schema.JsonObject | undefined;
  readonly tools: Pick<ToolAccess, 'callOnce'>;
}

const becauseOf = {
  tool_error: 'tool_error',
  server_failure: 'server_failure',
  timed_out: 'timed_out',
  cancelled: 'lost',
  not_offered: 'channel_not_offered',
} as const;

function endOf(ended: DeliveryCallEnded): AttemptEnd {
  if (ended.outcome === 'result') {
    return endedAs({ outcome: 'delivered', response_bytes: ended.bytes });
  }
  return endedAs({
    outcome: 'failed',
    because: becauseOf[ended.outcome],
    ...(ended.retryAfterMs === null ? {} : { retry_after_ms: ended.retryAfterMs }),
    ...(ended.detail === '' ? {} : { detail: ended.detail }),
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
  return Result.match(renderedArguments(channel, fields), {
    onFailure: () => Effect.succeed(endedAs({ outcome: 'refused', because: 'too_large' })),
    onSuccess: ({ input }) =>
      Effect.map(
        tools.callOnce({
          org: address.org,
          brain: address.brain,
          executionId: address.id,
          deliveryId: row.request_id,
          reference: { server: channel.server, tool: channel.tool },
          input,
        }),
        endOf,
      ),
  });
}
