import { Forbidden, InvalidInput, type BrainAddress, type CallerIdentity } from '@beonauto/operations';
import { answersRequest } from '@beonauto/outbound';
import { Effect, Result, type Schema } from 'effect';

import { channelFor, type ChannelSettings } from '../channels/channel-settings.ts';
import { checkedAnswer } from './answer-check.ts';
import type { OpenRequestRow } from './request-rows.ts';

const tokenRefused = new Forbidden({ detail: 'The answer token does not answer this request' });

export function answererOf(
  caller: CallerIdentity,
  row: OpenRequestRow | undefined,
  channels: ChannelSettings,
  brain: BrainAddress,
) {
  const token = caller.requestToken;
  if (token === undefined) {
    return Effect.succeed(caller.id);
  }
  const channel = row === undefined ? undefined : channelFor(channels, row.channel, brain);
  return row !== undefined && channel?.type === 'webhook' && answersRequest(channel.secret, row.request_id, token)
    ? Effect.succeed(`channel:${row.channel}`)
    : Effect.fail(tokenRefused);
}

export function answerFor(answer: Schema.Json, schema: Schema.JsonObject): Effect.Effect<Schema.Json, InvalidInput> {
  return Result.match(checkedAnswer(answer, schema), {
    onSuccess: Effect.succeed,
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: 'The answer does not match the answer schema of the request',
          issues: issues.map(({ pointer, detail }) => ({ pointer: `/answer${pointer}`, detail })),
        }),
      ),
  });
}
