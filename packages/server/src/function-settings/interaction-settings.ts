import type { Environment } from '@beonauto/config';
import { Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countOf } from '../settings/workflow-settings.ts';

export interface InteractionSettings {
  readonly mostOpenRequests: number;
}

const openRequests = { setting: 'INTERACTION_OPEN_REQUESTS', least: 1, most: 1_000_000, example: 10_000 };

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

export function readInteractionSettings(environment: Environment): InteractionSettings {
  return { mostOpenRequests: Effect.runSync(mostOpenRequestsOf(environment)) };
}
