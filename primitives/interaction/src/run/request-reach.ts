import { Unavailable, type BrainAddress, type Conflict } from '@beonauto/operations';
import type { RunContext } from '@beonauto/specs';
import { Effect, Result } from 'effect';

import { renderedArguments, type ArgumentsFailure } from '../channels/channel-arguments.ts';
import { inboxChannel } from '../channels/channel-names.ts';
import { channelFor, type Channel, type ChannelSettings } from '../channels/channel-settings.ts';
import type { RequestRecord } from './request-record.ts';
import { unworkable, type PartyRule } from './request-rendering.ts';
import { interactionBounds } from './run-bounds.ts';

export interface InteractionPorts {
  readonly channels: ChannelSettings;
  readonly openRequests: (brain: BrainAddress) => Effect.Effect<number>;
  readonly mostOpenRequests: number;
}

export type Reach = { readonly kind: 'inbox' } | { readonly kind: 'channel'; readonly channel: Channel };

const inbox: Reach = { kind: 'inbox' };

const anyParty: PartyRule = { channel: inboxChannel, allowsParty: () => true };

export function partyRuleOf(reach: Reach): PartyRule {
  return reach.kind === 'inbox' ? anyParty : { channel: reach.channel.name, allowsParty: reach.channel.allowsParty };
}

export function reachOf(
  channel: string,
  ports: InteractionPorts,
  brain: BrainAddress,
): Effect.Effect<Reach, Unavailable> {
  if (channel === inboxChannel) {
    return Effect.succeed(inbox);
  }
  const offered = channelFor(ports.channels, channel, brain);
  return offered === undefined
    ? Effect.fail(
        new Unavailable({
          detail: `The interaction function asks through the channel “${channel}”, which this server does not offer to this brain`,
          kind: 'channel_not_offered',
        }),
      )
    : Effect.succeed({ kind: 'channel', channel: offered });
}

export function roomFor(ports: InteractionPorts, brain: BrainAddress): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(ports.openRequests(brain), (open) =>
    open < ports.mostOpenRequests
      ? Effect.void
      : Effect.fail(
          new Unavailable({
            detail: `The brain holds ${open} open requests, the most it may; one must be answered, expire or be cancelled before another is asked`,
            kind: 'requests_full',
          }),
        ),
  );
}

const argumentWords = {
  not_text: 'renders a value that is not text for this request',
  too_long: `renders more than the ${interactionBounds.argumentBytes} bytes a call may send for this request`,
  missing_variable: 'reads what this request does not have',
  limit_exceeded: 'cannot be rendered for this request',
  failed: 'cannot be rendered for this request',
} as const;

function argumentsRefusal(channel: string, failure: ArgumentsFailure): Conflict {
  return failure.reason === 'too_large'
    ? unworkable(
        '',
        `The arguments of the call that delivers the request through the channel “${channel}” take ${failure.bytes} bytes, more than the ${interactionBounds.argumentBytes} a call may send`,
      )
    : unworkable(
        '',
        `The argument ${failure.argument} of the channel “${channel}” ${argumentWords[failure.failure.reason]}`,
      );
}

export function checkedArguments(
  reach: Reach,
  record: RequestRecord,
  context: RunContext,
): Effect.Effect<void, Conflict> {
  if (reach.kind === 'inbox' || reach.channel.type !== 'mcp') {
    return Effect.void;
  }
  const { channel } = reach;
  const fields = {
    to: record.to,
    message: record.message,
    run_id: context.id,
    function: context.spec.name,
    expires_at: record.expires_at,
    answer_schema: record.answer_schema ?? null,
  };
  return Result.match(renderedArguments(channel.with, fields), {
    onSuccess: () => Effect.void,
    onFailure: (failure) => Effect.fail(argumentsRefusal(channel.name, failure)),
  });
}
