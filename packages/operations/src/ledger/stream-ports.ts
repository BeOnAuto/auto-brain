import type { Effect } from 'effect';

import type { Conflict } from '../outcome/conflict.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type { Decider, StreamState, TypedEvent } from './decider.ts';

export interface StreamReader {
  readonly load: <State, Command, Event extends TypedEvent, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
  ) => Effect.Effect<StreamState<State>>;
}

export interface StreamWriter {
  readonly execute: <State, Command, Event extends TypedEvent, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
  ) => Effect.Effect<StreamState<State>, Rejection<R> | Conflict>;
}
