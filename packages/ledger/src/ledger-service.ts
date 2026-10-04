import {
  Ledger,
  type Decider,
  type DeclarableReason,
  type Rejection,
  type StreamState,
  type TypedEvent,
} from '@beonauto/operations';
import { Effect, Result } from 'effect';

import { eventAppenderOf } from './event-appender.ts';
import type { EventStore } from './event-store.ts';
import { foldEvents } from './fold-events.ts';
import { streamReaderOf } from './stream-reader.ts';
import { retriedOnVersionConflict, type VersionConflict } from './version-conflict.ts';

export function makeLedger(store: EventStore): Ledger['Service'] {
  const load = streamReaderOf(store);
  const append = eventAppenderOf(store);

  const attempt = <State, Command, Event extends TypedEvent, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
  ): Effect.Effect<Result.Result<StreamState<State>, Rejection<R>>, VersionConflict> =>
    Effect.gen(function* () {
      const { state, version } = yield* load(stream, decider);
      const decided = decider.decide(command, state);
      if (Result.isSuccess(decided) && decided.success.length > 0) {
        yield* append(stream, decider.eventSchema, decided.success, version);
      }
      return Result.map(decided, (events) => ({
        state: foldEvents(decider.evolve, state, events),
        version: version + events.length,
      }));
    });

  return Ledger.of({
    load,
    execute: (stream, decider, command) =>
      retriedOnVersionConflict(attempt(stream, decider, command)).pipe(Effect.flatMap(Effect.fromResult)),
  });
}
