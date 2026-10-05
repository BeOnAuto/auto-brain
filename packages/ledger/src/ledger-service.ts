import {
  Ledger,
  type Conflict,
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
import { recordedReaderOf } from './recorded/recorded-reader.ts';
import { streamReaderOf } from './stream-reader.ts';
import { retriedOnVersionConflict, type VersionConflict } from './version-conflict.ts';

export type StreamLoad<Loaded> = (stream: string) => Effect.Effect<Loaded>;

export type StreamAppend<Event> = (
  stream: string,
  events: readonly Event[],
  expectedVersion: number,
) => Effect.Effect<void, VersionConflict>;

export interface Decided<Loaded, State, Event> extends StreamState<State> {
  readonly loaded: Loaded;
  readonly events: readonly Event[];
}

export type DecisionLoop<Loaded, State, Command, Event, R extends DeclarableReason> = (
  stream: string,
  command: Command,
) => Effect.Effect<Decided<Loaded, State, Event>, Rejection<R> | Conflict>;

export function decisionLoop<
  Loaded extends StreamState<State>,
  State,
  Command,
  Event extends TypedEvent,
  R extends DeclarableReason,
>(
  load: StreamLoad<Loaded>,
  append: StreamAppend<Event>,
  decider: Decider<State, Command, Event, R>,
): DecisionLoop<Loaded, State, Command, Event, R> {
  const attempt = (
    stream: string,
    command: Command,
  ): Effect.Effect<Result.Result<Decided<Loaded, State, Event>, Rejection<R>>, VersionConflict> =>
    Effect.gen(function* () {
      const loaded = yield* load(stream);
      const decided = decider.decide(command, loaded.state);
      if (Result.isSuccess(decided) && decided.success.length > 0) {
        yield* append(stream, decided.success, loaded.version);
      }
      return Result.map(decided, (events: readonly Event[]) => ({
        loaded,
        events,
        state: foldEvents(decider.evolve, loaded.state, events),
        version: loaded.version + events.length,
      }));
    });
  return (stream, command) =>
    retriedOnVersionConflict(attempt(stream, command)).pipe(Effect.flatMap(Effect.fromResult));
}

export function makeLedger(store: EventStore): Ledger['Service'] {
  const load = streamReaderOf(store);
  const append = eventAppenderOf(store);

  return Ledger.of({
    load,
    execute: (stream, decider, command) =>
      decisionLoop(
        (named: string) => load(named, decider),
        (named, events, expectedVersion) => append(named, decider.eventSchema, events, expectedVersion),
        decider,
      )(stream, command).pipe(Effect.map(({ state, version }) => ({ state, version }))),
    readRecorded: recordedReaderOf(store),
  });
}
