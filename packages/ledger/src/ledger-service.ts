import {
  Conflict,
  Ledger,
  type Decider,
  type DeclarableReason,
  type Refusal,
  type StreamState,
  type TypedEvent,
} from '@beonauto/operations';
import { Effect, Result } from 'effect';

import { eventAppenderOf } from './event-appender.ts';
import type { EventStore } from './event-store.ts';
import { evolved } from './evolved.ts';
import { streamLoaderOf } from './stream-loader.ts';
import type { VersionConflict } from './version-conflict.ts';

const retriesOnVersionConflict = 3;

const changedWhileDeciding = 'The state changed while the command was decided';

export function ledgerOver(store: EventStore): Ledger['Service'] {
  const load = streamLoaderOf(store);
  const append = eventAppenderOf(store);

  const attempt = <State, Command, Event extends TypedEvent, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
  ): Effect.Effect<Result.Result<StreamState<State>, Refusal<R>>, VersionConflict> =>
    Effect.gen(function* () {
      const { state, version } = yield* load(stream, decider);
      const decided = decider.decide(command, state);
      if (Result.isSuccess(decided) && decided.success.length > 0) {
        yield* append(stream, decider.eventSchema, decided.success, version);
      }
      return Result.map(decided, (events) => ({
        state: evolved(decider.evolve, state, events),
        version: version + events.length,
      }));
    });

  return Ledger.of({
    load,
    execute: (stream, decider, command) =>
      attempt(stream, decider, command).pipe(
        Effect.retry({ times: retriesOnVersionConflict }),
        Effect.mapError(() => new Conflict({ detail: changedWhileDeciding })),
        Effect.flatMap(Effect.fromResult),
      ),
  });
}
