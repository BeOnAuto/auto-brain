import { runEnded, runSettler, workRecorder, type Settlement } from '@on.auto/definitions';
import type { Lineage } from '@on.auto/operations';
import { Effect, Equal, type Schema } from 'effect';

import type { PredictionPorts, StartChild } from '../capability/prediction-ports.ts';
import { buildRunFacts } from '../facts/prediction-facts.ts';
import { predictionBuildsName, type BuildRow } from './build-rows.ts';
import type { BuildAddress, BuildState } from './build-state.ts';

export interface Performing {
  readonly ports: PredictionPorts;
  readonly runs: StartChild;
  readonly row: BuildRow;
  readonly build: BuildState;
  readonly lineage: Lineage;
  readonly now: number;
}

export const aMinute = 60_000;

function endedMeanwhile(error: unknown): boolean {
  return Equal.equals(error, runEnded);
}

export function advanced(
  { ports }: Pick<Performing, 'ports'>,
  { org, playbook, id }: BuildAddress,
  set: { readonly next_due_at?: number | null; readonly staged?: boolean },
): Effect.Effect<void> {
  return ports.ledger.advanceRow(predictionBuildsName, { org, playbook }, id, { set, when: [] });
}

export function restingUntil(performing: Performing, at: number | null): Effect.Effect<void> {
  return advanced(performing, performing.build.address, { next_due_at: at });
}

export function recordedWork(
  { ports, build, lineage }: Performing,
  fact: { readonly type: string; readonly data: Schema.JsonObject },
): Effect.Effect<void> {
  const record = workRecorder(ports.ledger, buildRunFacts);
  return record(build.address, { type: 'work', fact }, lineage).pipe(
    Effect.asVoid,
    Effect.catchIf(endedMeanwhile, () => Effect.void),
    Effect.orDie,
  );
}

export function settledBuild({ ports, build, lineage }: Performing, settlement: Settlement): Effect.Effect<void> {
  return runSettler(ports.ledger)(build.address, settlement, lineage).pipe(
    Effect.asVoid,
    Effect.catchTag('conflict', () => Effect.void),
    Effect.orDie,
  );
}
