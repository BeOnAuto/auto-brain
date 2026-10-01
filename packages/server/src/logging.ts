import { Cause, Effect, Logger } from 'effect';

export const jsonLogsToStderr = Logger.layer([Logger.withConsoleError(Logger.formatJson)]);

export interface Access {
  readonly localMode: boolean;
  readonly apiKeysConfigured: boolean;
}

export function announceAccess({ localMode, apiKeysConfigured }: Access): Effect.Effect<void> {
  if (localMode) {
    return Effect.logInfo('Local mode is on: the server listens only on loopback and no API keys are configured');
  }
  return apiKeysConfigured ? Effect.void : Effect.logWarning('Local mode is off and no API keys are configured');
}

export function logIncident(incident: string, error: Readonly<Error>): Effect.Effect<void> {
  return Effect.logError('Unexpected error', Cause.die(error)).pipe(Effect.annotateLogs({ incident }));
}
