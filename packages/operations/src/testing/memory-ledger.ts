import { Effect, Layer, Result, Schema } from 'effect';

import { Conflict, Ledger, type Decider, type DeclarableReason, type StreamState } from '../index.ts';

export interface MemoryLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
  readonly streamNames: () => readonly string[];
}

function folded<State, Command, Event, R extends DeclarableReason>(
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

export function memoryLedger(): MemoryLedger {
  const streams = new Map<string, readonly unknown[]>();
  const storedIn = (stream: string): readonly unknown[] => streams.get(stream) ?? [];
  const service = Ledger.of({
    load: (stream, decider) => folded(decider, storedIn(stream)),
    execute: (stream, decider, command) =>
      Effect.gen(function* () {
        const { state, version } = yield* folded(decider, storedIn(stream));
        yield* Effect.yieldNow;
        const decided = decider.decide(command, state);
        if (Result.isFailure(decided)) {
          return yield* Effect.fail(decided.failure);
        }
        if (storedIn(stream).length !== version) {
          return yield* Effect.fail(new Conflict({ detail: `The stream ${stream} moved` }));
        }
        const encodeEvent = Schema.encodeUnknownEffect(Schema.toCodecJson(decider.eventSchema));
        const encoded = yield* Effect.forEach(decided.success, (event) => Effect.orDie(encodeEvent(event)));
        streams.set(stream, [...storedIn(stream), ...encoded]);
        return {
          state: decided.success.reduce((evolved, event) => decider.evolve(evolved, event), state),
          version: version + decided.success.length,
        };
      }),
  });
  return { service, layer: Layer.succeed(Ledger, service), streamNames: () => [...streams.keys()] };
}
