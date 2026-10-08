import type { Environment, FileUse } from '@beonauto/config';
import { ChannelSettingsInvalid, readChannelSettings, type ChannelSettings } from '@beonauto/interaction';
import type { McpSettings } from '@beonauto/mcp';
import { Effect, Schema } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { Origin } from '../settings/origin.ts';
import { countOf } from '../settings/workflow-settings.ts';
import { listedIn, type Problems } from './reasoning-settings.ts';

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

const loopbackHosts: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const exampleOrigin = 'such as https://brains.example.com';

interface Listening {
  readonly host: string;
  readonly port: number;
}

function refusedOrigin(detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The interaction settings are invalid. PUBLIC_ORIGIN: ${detail}` });
}

function writtenOriginOf(written: string): Effect.Effect<string, InvalidSettingsError> {
  if (!isOrigin(written)) {
    return Effect.fail(refusedOrigin(`Expected an origin ${exampleOrigin}`));
  }
  const { protocol, hostname } = new URL(written);
  return protocol === 'https:' || loopbackHosts.has(hostname)
    ? Effect.succeed(written)
    : Effect.fail(refusedOrigin(`Expected an https origin, or http on a loopback address, ${exampleOrigin}`));
}

function hasWebhook({ channels }: ChannelSettings): boolean {
  return [...channels.values()].some(({ type }) => type === 'webhook');
}

function originOf(
  environment: Environment,
  channels: ChannelSettings,
  { host, port }: Listening,
): Effect.Effect<string, InvalidSettingsError> {
  const written = environment['PUBLIC_ORIGIN'] ?? '';
  if (written !== '') {
    return writtenOriginOf(written);
  }
  return loopbackHosts.has(host) || !hasWebhook(channels)
    ? Effect.succeed(`http://localhost:${port}`)
    : Effect.fail(
        refusedOrigin(
          `Expected the origin a delivered request names, ${exampleOrigin}, which a webhook channel needs on a server that listens beyond loopback`,
        ),
      );
}

export function readInteractionSettings(
  environment: Environment,
  file: FileUse | undefined,
  { servers }: McpSettings,
  listening: Listening,
): InteractionSettings {
  const context = { servers: servers.map(({ name, org, brains, allowed }) => ({ name, org, brains, allowed })) };
  return Effect.runSync(
    Effect.gen(function* () {
      const channels = yield* readChannelSettings(environment, context).pipe(
        Effect.mapError((invalid: Problems) => placed(invalid, file)),
      );
      const mostOpenRequests = yield* mostOpenRequestsOf(environment);
      const origin = yield* originOf(environment, channels, listening);
      return { channels, mostOpenRequests, origin };
    }),
  );
}
