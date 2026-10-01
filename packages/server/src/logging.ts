import type { AccessMode } from '@beonauto/identity';
import type { Incident } from '@beonauto/operations';
import { Cause, Effect, Logger } from 'effect';

export const jsonLogsToStderr = Logger.layer([Logger.withConsoleError(Logger.formatJson)]);

const accessNotices: Readonly<Record<AccessMode, Effect.Effect<void>>> = {
  local: Effect.logWarning(
    'Local mode is on: every request is trusted as the local developer, with every permission in every org. Never enable LOCAL_MODE on a machine reachable through a proxy',
  ),
  closed: Effect.logWarning(
    'No request can authenticate: API_KEYS lists no keys and local mode is off, so every path except /health answers 401',
  ),
  keys: Effect.void,
};

const localModeIgnored = Effect.logWarning('LOCAL_MODE is ignored because API keys are configured');

export function logAccessMode(mode: AccessMode, localModeRequested: boolean): Effect.Effect<void> {
  return localModeRequested && mode !== 'local'
    ? Effect.andThen(accessNotices[mode], localModeIgnored)
    : accessNotices[mode];
}

export function logIncident({ id, original, call }: Incident): Effect.Effect<void> {
  return Effect.logError('Unexpected error', Cause.die(original)).pipe(Effect.annotateLogs({ incident: id, ...call }));
}
