import { messageIdOf, type Lineage } from '@beonauto/operations';
import { stepEventIdOf, type OutputOrigin, type RecordLineage, type RunContext } from '@beonauto/workflow-engine';
import { Effect, Option, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { armedByOf } from '../timers/sql-timers.ts';
import { addressOfRun, runLogStreamOf } from './run-address.ts';

const GivenLineageSchema = Schema.Struct({
  lineage: Schema.Struct({ start: Schema.String, correlation: Schema.String }),
});

interface GivenLineage {
  readonly start: string | null;
  readonly correlation: string;
}

const decodeGiven = Schema.decodeUnknownOption(GivenLineageSchema);

function givenOf(runKey: string, attributes: Schema.JsonObject): GivenLineage {
  return Option.match(decodeGiven(attributes), {
    onNone: () => ({ start: null, correlation: addressOfRun(runKey).runId }),
    onSome: ({ lineage }) => lineage,
  });
}

export function correlationOfRun(runKey: string, attributes: Schema.JsonObject): string {
  return givenOf(runKey, attributes).correlation;
}

function causeOfRecord(
  database: HostDatabase,
  runKey: string,
  { cause }: RecordLineage,
  given: GivenLineage,
): Effect.Effect<string | null> {
  if (cause.kind === 'start') {
    return Effect.succeed(given.start);
  }
  if (cause.kind === 'resumed') {
    return Effect.succeed(stepEventIdOf(addressOfRun(runKey).runId, cause.step));
  }
  if (cause.kind === 'given') {
    return Effect.succeed(cause.id);
  }
  return cause.kind === 'timer'
    ? Effect.map(armedByOf(database, runKey, cause.timerId), (armedBy) =>
        armedBy === null ? null : messageIdOf(runLogStreamOf(runKey), armedBy),
      )
    : Effect.succeed(null);
}

export function lineageOfRecord(
  database: HostDatabase,
  runKey: string,
  lineage: RecordLineage,
): Effect.Effect<Lineage> {
  const given = givenOf(runKey, lineage.attributes);
  return Effect.map(causeOfRecord(database, runKey, lineage, given), (causationId) => ({
    causationId,
    correlationId: given.correlation,
  }));
}

export function lineageOfSettlement({ runId: runKey, attributes }: RunContext, origin: OutputOrigin): Lineage {
  const { lastStep, version } = origin;
  return {
    causationId:
      lastStep === null
        ? messageIdOf(runLogStreamOf(runKey), version)
        : stepEventIdOf(addressOfRun(runKey).runId, lastStep),
    correlationId: givenOf(runKey, attributes).correlation,
  };
}
