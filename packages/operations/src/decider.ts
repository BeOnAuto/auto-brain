import type { Result, Schema } from 'effect';

import type { DeclarableReason, Refusal } from './refusal.ts';

export interface Decider<State, Command, Event, R extends DeclarableReason = never> {
  readonly initialState: State;
  readonly evolve: (state: State, event: Event) => State;
  readonly decide: (command: Command, state: State) => Result.Result<readonly Event[], Refusal<R>>;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
}

export interface StreamState<State> {
  readonly state: State;
  readonly version: number;
}
