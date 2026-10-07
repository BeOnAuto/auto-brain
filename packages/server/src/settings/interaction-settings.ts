import type { Environment, FileUse } from '@beonauto/config';
import { ChannelSettingsInvalid, readChannelSettings, type ChannelSettings } from '@beonauto/interaction';
import type { McpSettings } from '@beonauto/mcp';
import { Effect, Schema } from 'effect';

import { InvalidSettingsError } from './invalid-settings-error.ts';
import { Origin } from './origin.ts';
import { listedIn, type Problems } from './reasoning-settings.ts';
import { countOf } from './workflow-settings.ts';

export interface InteractionSettings {
  readonly channels: ChannelSettings;
  readonly mostOpenRequests: number;
  readonly origin: string;
}

const openRequests = { setting: 'INTERACTION_OPEN_REQUESTS', least: 1, most: 1_000_000, example: 10_000 };

const isOrigin = Schema.is(Origin);

function placed(invalid: Problems, file: FileUse | undefined): ChannelSettingsInvalid {
  const { problems } = invalid;
  return new ChannelSettingsInvalid({
    message: `The channel settings are invalid. ${listedIn(invalid, file)}`,
    problems,
  });
}

function mostOpenRequestsOf(environment: Environment): Effect.Effect<number, InvalidSettingsError> {
  const written = environment[openRequests.setting] ?? '';
  const most = written === '' ? openRequests.example : countOf(written);
  return most >= openRequests.least && most <= openRequests.most
    ? Effect.succeed(most)
    : Effect.fail(
        new InvalidSettingsError({
          message: `The interaction settings are invalid. ${openRequests.setting}: Expected a whole number from ${openRequests.least} to ${openRequests.most}, such as ${openRequests.example}`,
        }),
      );
}

function originOf(environment: Environment): Effect.Effect<string | undefined, InvalidSettingsError> {
  const written = environment['PUBLIC_ORIGIN'] ?? '';
  if (written === '') {
    return Effect.undefined;
  }
  return isOrigin(written)
    ? Effect.succeed(written)
    : Effect.fail(
        new InvalidSettingsError({
          message:
            'The interaction settings are invalid. PUBLIC_ORIGIN: Expected an origin such as https://brains.example.com',
        }),
      );
}

export function readInteractionSettings(
  environment: Environment,
  file: FileUse | undefined,
  { servers, allowed }: McpSettings,
  port: number,
): InteractionSettings {
  const context = { servers: servers.map(({ name, org, brains }) => ({ name, org, brains })), allowed };
  return Effect.runSync(
    Effect.all({
      channels: readChannelSettings(environment, context).pipe(
        Effect.mapError((invalid: Problems) => placed(invalid, file)),
      ),
      mostOpenRequests: mostOpenRequestsOf(environment),
      origin: Effect.map(originOf(environment), (origin) => origin ?? `http://localhost:${port}`),
    }),
  );
}
