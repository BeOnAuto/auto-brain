import type { Environment } from '@beonauto/config';
import { Effect, Option, Schema, type Layer } from 'effect';

import { logsToStderr } from '../logging/logging.ts';

export interface RunnerLog {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
  readonly temporal: (line: string) => void;
}

type Log = (message: string) => Effect.Effect<void>;

const temporalLevels: Readonly<Record<string, Log>> = {
  ERROR: Effect.logError,
  WARN: Effect.logWarning,
  INFO: Effect.logInfo,
};

const temporalEntryOf = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

const textOf = Schema.decodeUnknownOption(Schema.String);

interface TemporalLine {
  readonly log: Log;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

function temporalLineOf(line: string): TemporalLine {
  const {
    time: _time,
    level,
    msg,
    ...fields
  } = Option.getOrElse(temporalEntryOf(line), (): Readonly<Record<string, unknown>> => ({ msg: line }));
  const message = Option.getOrElse(textOf(msg), () => line);
  return { log: temporalLevels[Option.getOrElse(textOf(level), () => 'ERROR')] ?? Effect.logWarning, message, fields };
}

export function runnerLog(logs: Layer.Layer<never>): RunnerLog {
  const write = (log: Log, message: string, annotations: Readonly<Record<string, unknown>>): void => {
    Effect.runSync(log(message).pipe(Effect.annotateLogs(annotations), Effect.provide(logs)));
  };
  return {
    info: (message) => {
      write(Effect.logInfo, message, { source: 'dev' });
    },
    warn: (message) => {
      write(Effect.logWarning, message, { source: 'dev' });
    },
    error: (message) => {
      write(Effect.logError, message, { source: 'dev' });
    },
    temporal: (line) => {
      const { log, message, fields } = temporalLineOf(line);
      write(log, message, { source: 'temporal', ...fields });
    },
  };
}

export function runnerLogFor(settings: Environment): RunnerLog {
  return runnerLog(logsToStderr(settings['LOG_FORMAT'] === 'pretty' ? 'pretty' : 'json'));
}
