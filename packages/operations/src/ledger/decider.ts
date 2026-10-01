import type { Result, Schema } from 'effect';

import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';

export interface TypedEvent {
  readonly type: string;
}

export interface Decider<State, Command, Event extends TypedEvent, R extends DeclarableReason = never> {
  readonly initialState: State;
  readonly evolve: (state: State, event: Event) => State;
  readonly decide: (command: Command, state: State) => Result.Result<readonly Event[], Rejection<R>>;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
}

export interface StreamState<State> {
  readonly state: State;
  readonly version: number;
}
