import {
  Forbidden,
  InvalidInput,
  requestTokenRefused,
  type BrainAddress,
  type CallerIdentity,
} from '@beonauto/operations';
import { answersRequest, requestOfAnswerToken } from '@beonauto/outbound';
import { Effect, Result, type Schema } from 'effect';

import { channelFor, type Channel, type ChannelSettings } from '../channels/channel-settings.ts';
import { checkedAnswer } from './answer-check.ts';
import type { OpenRequestRow } from './request-rows.ts';

const tokenRefused = new Forbidden({ detail: requestTokenRefused });

export interface TokenHolder {
  readonly requestId: string;
  readonly signedThrough: (channel: string) => boolean;
}

function signedBy(channel: Channel | undefined, requestId: string, token: string): boolean {
  return channel?.type === 'webhook' && answersRequest(channel.secret, requestId, token);
}

export function tokenHolderOf(
  { requestToken }: CallerIdentity,
  channels: ChannelSettings,
  brain: BrainAddress,
): Effect.Effect<TokenHolder | undefined, Forbidden> {
  if (requestToken === undefined) {
    return Effect.undefined;
  }
  const requestId = requestOfAnswerToken(requestToken) ?? '';
  const signedThrough = (channel: string) => signedBy(channelFor(channels, channel, brain), requestId, requestToken);
  return [...channels.channels.keys()].some((channel) => signedThrough(channel))
    ? Effect.succeed({ requestId, signedThrough })
    : Effect.fail(tokenRefused);
}

export function answererOf(
  caller: CallerIdentity,
  holder: TokenHolder | undefined,
  row: OpenRequestRow | undefined,
): Effect.Effect<string, Forbidden> {
  if (holder === undefined) {
    return Effect.succeed(caller.id);
  }
  return row?.request_id === holder.requestId && holder.signedThrough(row.channel)
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
