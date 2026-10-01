import type { AccessMode } from '@beonauto/identity';
import type { ProviderStatus } from '@beonauto/inference';
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

const causeNotFormattable = Effect.logError('Unexpected error whose cause could not be formatted');

function withoutRequestContent(error: Readonly<Error>): string {
  return error instanceof SyntaxError ? 'The request body is not valid JSON' : error.message;
}

export function logMcpError(error: Readonly<Error>): Effect.Effect<void> {
  return Effect.logWarning('The MCP layer reported an error').pipe(
    Effect.annotateLogs({ error: withoutRequestContent(error) }),
  );
}

export function logIncident({ id, original, call }: Incident): Effect.Effect<void> {
  return Effect.logError('Unexpected error', Cause.die(original)).pipe(
    Effect.catchCause(() => causeNotFormattable),
    Effect.ignoreCause,
    Effect.annotateLogs({ incident: id, ...call }),
  );
}

export function logModelProviders({ configured, unconfigured }: ProviderStatus): Effect.Effect<void> {
  return Effect.all(
    [
      ...configured.map((provider) =>
        Effect.logInfo(`Model provider ${provider} is configured`).pipe(
          Effect.annotateLogs({ provider, configured: true }),
        ),
      ),
      ...unconfigured.map(({ provider, missing }) =>
        Effect.logInfo(`Model provider ${provider} is not configured; it needs ${missing.join(' and ')}`).pipe(
          Effect.annotateLogs({ provider, configured: false, missing }),
        ),
      ),
    ],
    { discard: true },
  );
}
