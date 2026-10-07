import {
  Forbidden,
  InvalidInput,
  requestTokenRefused,
  type BrainAddress,
  type CallerIdentity,
} from '@beonauto/operations';
import { answersRequest, requestOfAnswerToken } from '@beonauto/outbound';
import { Effect, Result, type Schema } from 'effect';

import { channelFor, type ChannelSettings } from '../channels/channel-settings.ts';
import { checkedAnswer } from './answer-check.ts';
import type { OpenRequestRow } from './request-rows.ts';

const tokenRefused = new Forbidden({ detail: requestTokenRefused });

export interface TokenHolder {
  readonly requestId: string;
  readonly channel: string;
}

function webhookAnswering(channels: ChannelSettings, brain: BrainAddress, requestId: string, token: string) {
  return [...channels.channels.values()].find(
    (channel) =>
      channel.type === 'webhook' &&
      channelFor(channels, channel.name, brain) !== undefined &&
      answersRequest(channel.secret, requestId, token),
  );
}

export function tokenHolderOf(
  { requestToken }: CallerIdentity,
  channels: ChannelSettings,
  brain: BrainAddress,
): Effect.Effect<TokenHolder | undefined, Forbidden> {
  if (requestToken === undefined) {
    return Effect.undefined;
  }
  const requestId = requestOfAnswerToken(requestToken);
  const channel = requestId === undefined ? undefined : webhookAnswering(channels, brain, requestId, requestToken);
  return requestId === undefined || channel === undefined
    ? Effect.fail(tokenRefused)
    : Effect.succeed({ requestId, channel: channel.name });
}

export function answererOf(
  caller: CallerIdentity,
  holder: TokenHolder | undefined,
  row: OpenRequestRow | undefined,
): Effect.Effect<string, Forbidden> {
  if (holder === undefined) {
    return Effect.succeed(caller.id);
  }
  return row?.request_id === holder.requestId && row.channel === holder.channel
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
