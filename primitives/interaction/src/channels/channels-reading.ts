import {
  credentialProblems,
  decodedJsonSetting,
  misplacedReferences,
  pointerOf,
  problem,
  secretsOfEntry,
  substituted,
  type Environment,
  type ReferencePlacement,
  type SettingProblem,
} from '@beonauto/config';
import { Data, Effect, Result, Schema } from 'effect';

import { interactionBounds } from '../run/run-bounds.ts';
import { checkedChannel, type ChannelContext } from './channel-checks.ts';
import {
  ChannelsSchema,
  channelsSetting,
  McpEntrySchema,
  WebhookEntrySchema,
  type ChannelEntry,
} from './channel-entries.ts';
import type { Channel, ChannelSettings } from './channel-settings.ts';

export class ChannelSettingsInvalid extends Data.TaggedError('channel_settings_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

const credentialAdvice =
  'Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${PARTNER_API_KEY}';

const misplaced =
  'Holds a reference to an environment variable, which only headers and secret may hold, so a secret never reaches a template or a URL';

const decodeEntry = Schema.decodeUnknownSync(Schema.Union([WebhookEntrySchema, McpEntrySchema]));

interface ReadChannel {
  readonly channel: Channel;
  readonly secrets: ReturnType<typeof secretsOfEntry>;
}

function placementOf(entry: string): ReferencePlacement {
  return { setting: channelsSetting, entry, fields: ['headers', 'secret'], misplaced };
}

function readEntry(
  name: string,
  written: ChannelEntry,
  environment: Environment,
  context: ChannelContext,
): Result.Result<ReadChannel, readonly SettingProblem[]> {
  const pointer = pointerOf([name]);
  const credentials = credentialProblems(name, written, pointer).map(({ pointer: place }) =>
    problem(channelsSetting, place, credentialAdvice),
  );
  const resolved = substituted(written, pointer, environment);
  const unresolved = resolved.problems.map(({ pointer: place, detail }) => problem(channelsSetting, place, detail));
  const problems = [...credentials, ...unresolved, ...misplacedReferences(placementOf(name), resolved.references)];
  if (problems.length > 0) {
    return Result.fail(problems);
  }
  return Result.map(checkedChannel(name, decodeEntry(resolved.value), context), (channel) => ({
    channel,
    secrets: secretsOfEntry(placementOf(name), resolved.references),
  }));
}

function countProblems(names: readonly string[]): readonly SettingProblem[] {
  return names.length > interactionBounds.channels
    ? [problem(channelsSetting, '', `Expected at most ${interactionBounds.channels} channels, not ${names.length}`)]
    : [];
}

function channelsOf(
  text: string,
  environment: Environment,
  context: ChannelContext,
): Result.Result<ChannelSettings, readonly SettingProblem[]> {
  return Result.flatMap(decodedJsonSetting(channelsSetting, text, ChannelsSchema), (entries) => {
    const problems: SettingProblem[] = [...countProblems(Object.keys(entries))];
    const channels: ReadChannel[] = [];
    for (const [name, entry] of Object.entries(entries)) {
      const read = readEntry(name, entry, environment, context);
      if (Result.isFailure(read)) {
        problems.push(...read.failure);
      } else {
        channels.push(read.success);
      }
    }
    return problems.length > 0
      ? Result.fail(problems)
      : Result.succeed({
          channels: new Map(channels.map(({ channel }) => [channel.name, channel])),
          secrets: channels.flatMap(({ secrets }) => secrets),
        });
  });
}

function invalid(problems: readonly SettingProblem[]): ChannelSettingsInvalid {
  const listed = problems.map(({ setting, detail }) => `${setting}: ${detail}`).join('; ');
  return new ChannelSettingsInvalid({ message: `The channel settings are invalid. ${listed}`, problems });
}

export function readChannelSettings(
  environment: Environment,
  context: ChannelContext,
): Effect.Effect<ChannelSettings, ChannelSettingsInvalid> {
  const text = environment[channelsSetting] ?? '';
  if (text.trim() === '') {
    return Effect.succeed({ channels: new Map(), secrets: [] });
  }
  return Result.match(channelsOf(text, environment, context), {
    onSuccess: Effect.succeed,
    onFailure: (problems) => Effect.fail(invalid(problems)),
  });
}
