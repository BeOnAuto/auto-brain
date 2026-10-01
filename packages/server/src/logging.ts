import type { AccessMode } from '@beonauto/identity';
import type { Incident } from '@beonauto/operations';
import { Cause, Effect, Logger } from 'effect';

export const jsonLogsToStderr = Logger.layer([Logger.withConsoleError(Logger.formatJson)]);

const accessNotices: Readonly<Record<AccessMode, Effect.Effect<void>>> = {
  local: Effect.logInfo('Local mode is on: the server listens only on loopback and no API keys are configured'),
  closed: Effect.logWarning('Local mode is off and no API keys are configured'),
  keys: Effect.void,
};

export function announceAccess(mode: AccessMode): Effect.Effect<void> {
  return accessNotices[mode];
}

export function logIncident({ id, original, call }: Incident): Effect.Effect<void> {
  return Effect.logError('Unexpected error', Cause.die(original)).pipe(Effect.annotateLogs({ incident: id, ...call }));
}
