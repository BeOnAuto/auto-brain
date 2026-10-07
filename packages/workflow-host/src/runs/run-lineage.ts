import { messageIdOf, type Lineage } from '@beonauto/operations';
import { stepEventIdOf, type OutputOrigin, type RecordLineage, type RunContext } from '@beonauto/workflow-engine';
import { Effect, Option, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { armedByOf } from '../timers/sql-timers.ts';
import { addressOfRun, streamOfRun } from './run-address.ts';

const GivenLineageSchema = Schema.Struct({
  lineage: Schema.Struct({ start: Schema.String, correlation: Schema.String }),
});

interface GivenLineage {
  readonly start: string | null;
  readonly correlation: string;
}

const decodeGiven = Schema.decodeUnknownOption(GivenLineageSchema);

function givenOf(runId: string, attributes: Schema.JsonObject): GivenLineage {
  return Option.match(decodeGiven(attributes), {
    onNone: () => ({ start: null, correlation: addressOfRun(runId).executionId }),
    onSome: ({ lineage }) => lineage,
  });
}

export function correlationOfRun(runId: string, attributes: Schema.JsonObject): string {
  return givenOf(runId, attributes).correlation;
}

function causeOfRecord(
  database: HostDatabase,
  runId: string,
  { cause }: RecordLineage,
  given: GivenLineage,
): Effect.Effect<string | null> {
  if (cause.kind === 'start') {
    return Effect.succeed(given.start);
  }
  if (cause.kind === 'resumed') {
    return Effect.succeed(stepEventIdOf(addressOfRun(runId).executionId, cause.step));
  }
  if (cause.kind === 'given') {
    return Effect.succeed(cause.id);
  }
  return cause.kind === 'timer'
    ? Effect.map(armedByOf(database, runId, cause.timerId), (armedBy) =>
        armedBy === null ? null : messageIdOf(streamOfRun(runId), armedBy),
      )
    : Effect.succeed(null);
}

export function lineageOfRecord(database: HostDatabase, runId: string, lineage: RecordLineage): Effect.Effect<Lineage> {
  const given = givenOf(runId, lineage.attributes);
  return Effect.map(causeOfRecord(database, runId, lineage, given), (causationId) => ({
    causationId,
    correlationId: given.correlation,
  }));
}

export function lineageOfSettlement({ executionId: runId, attributes }: RunContext, origin: OutputOrigin): Lineage {
  const { lastStep, version } = origin;
  return {
    causationId:
      lastStep === null
        ? messageIdOf(streamOfRun(runId), version)
        : stepEventIdOf(addressOfRun(runId).executionId, lastStep),
    correlationId: givenOf(runId, attributes).correlation,
  };
}
