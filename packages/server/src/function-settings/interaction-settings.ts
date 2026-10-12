import type { Environment } from '@beonauto/config';
import type { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn } from './counted-settings.ts';

export interface InteractionSettings {
  readonly mostOpenRequests: number;
}

const mostOpenRequests = { setting: 'INTERACTION_OPEN_REQUESTS', least: 1, most: 1_000_000, example: 10_000 };

export function readInteractionSettings(
  environment: Environment,
): Effect.Effect<InteractionSettings, InvalidSettingsError> {
  return countsIn(environment, { settings: 'interaction settings', bounds: { mostOpenRequests } });
}
