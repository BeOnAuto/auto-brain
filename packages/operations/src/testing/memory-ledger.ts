import { Clock, Effect, Layer, Result, Schema } from 'effect';

import {
  Conflict,
  Ledger,
  messageIdOf,
  noLineage,
  type Decider,
  type DeclarableReason,
  type Lineage,
  type RunOutcomeMapping,
  type KeyedProjection,
  type StreamState,
  type TypedEvent,
} from '../index.ts';
import { memoryProjections, type MemoryProjections } from '../projections/memory-projections.ts';
import { memoryRunOutcomes, type MemoryRunOutcomes } from '../run-outcomes/memory-run-outcomes.ts';
import { memoryRecordedReader, type MemoryRecord } from './memory-recorded.ts';

export interface MemoryLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
  readonly streamNames: () => readonly string[];
}

interface Appended {
  readonly stream: string;
  readonly events: readonly TypedEvent[];
  readonly encoded: readonly unknown[];
  readonly lineage: Lineage;
}

interface Kept {
  readonly streams: Map<string, readonly unknown[]>;
  readonly log: readonly MemoryRecord[];
  readonly logged: (records: readonly MemoryRecord[]) => void;
  readonly outcomes: MemoryRunOutcomes;
  readonly projected: MemoryProjections;
}

function folded<State, Command, Event extends TypedEvent, R extends DeclarableReason>(
  decider: Decider<State, Command, Event, R>,
  stored: readonly unknown[],
): Effect.Effect<StreamState<State>> {
  const decodeEvent = Schema.decodeUnknownEffect(Schema.toCodecJson(decider.eventSchema));
  return Effect.forEach(stored, (event) => Effect.orDie(decodeEvent(event))).pipe(
    Effect.map((events: readonly Event[]) => ({
      state: events.reduce((state, event) => decider.evolve(state, event), decider.initialState),
      version: events.length,
    })),
  );
}

function storedIn({ streams }: Kept, stream: string): readonly unknown[] {
  return streams.get(stream) ?? [];
}

function recorded(kept: Kept, { stream, events, encoded, lineage }: Appended, at: number): void {
  const version = storedIn(kept, stream).length;
  kept.outcomes.project(stream, events, encoded);
  kept.projected.project(stream, events, encoded, version + 1);
  kept.logged(
    events.map(({ type }, index) => ({
      position: kept.log.length + index + 1,
      id: messageIdOf(stream, version + index + 1),
      ...lineage,
      stream,
      streamPosition: version + index + 1,
      type,
      data: encoded[index],
      recordedAt: new Date(at).toISOString(),
    })),
  );
  kept.streams.set(stream, [...storedIn(kept, stream), ...encoded]);
}

function executedOn(kept: Kept): Ledger['Service']['execute'] {
  return (stream, decider, command, lineage = noLineage) =>
    Effect.gen(function* () {
      const { state, version } = yield* folded(decider, storedIn(kept, stream));
      yield* Effect.yieldNow;
      const decided = decider.decide(command, state);
      if (Result.isFailure(decided)) {
        return yield* Effect.fail(decided.failure);
      }
      if (storedIn(kept, stream).length !== version) {
        return yield* Effect.fail(
          new Conflict({ detail: 'The state changed while the command was decided', kind: 'concurrent_change' }),
        );
      }
      const encodeEvent = Schema.encodeUnknownEffect(Schema.toCodecJson(decider.eventSchema));
      const encoded = yield* Effect.forEach(decided.success, (event) => Effect.orDie(encodeEvent(event)));
      recorded(kept, { stream, events: decided.success, encoded, lineage }, yield* Clock.currentTimeMillis);
      return {
        state: decided.success.reduce((evolved, event) => decider.evolve(evolved, event), state),
        version: version + decided.success.length,
      };
    });
}

export function memoryLedger(
  runOutcomes?: RunOutcomeMapping,
  projections: readonly KeyedProjection[] = [],
): MemoryLedger {
  const log: MemoryRecord[] = [];
  const kept: Kept = {
    streams: new Map(),
    log,
    logged: (records) => {
      log.push(...records);
    },
    outcomes: memoryRunOutcomes(runOutcomes),
    projected: memoryProjections(projections),
  };
  const { projected } = kept;
  const service = Ledger.of({
    load: (stream, decider) => Effect.suspend(() => folded(decider, storedIn(kept, stream))),
    execute: executedOn(kept),
    readRecorded: memoryRecordedReader(kept.log),
    readRunOutcomes: kept.outcomes.readRunOutcomes,
    readProjectedRows: projected.readProjectedRows,
    countProjectedRows: projected.countProjectedRows,
    readDueRows: projected.readDueRows,
    nextDueOf: projected.nextDueOf,
    advanceRow: projected.advanceRow,
  });
  return { service, layer: Layer.succeed(Ledger, service), streamNames: () => [...kept.streams.keys()] };
}
