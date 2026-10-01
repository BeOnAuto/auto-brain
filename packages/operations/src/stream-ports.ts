import type { Effect } from 'effect';

import type { Conflict } from './conflict.ts';
import type { Decider, StreamState } from './decider.ts';
import type { DeclarableReason, Refusal } from './refusal.ts';

export interface StreamReader {
  readonly load: <State, Command, Event, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
  ) => Effect.Effect<StreamState<State>>;
}

export interface StreamWriter {
  readonly execute: <State, Command, Event, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
  ) => Effect.Effect<StreamState<State>, Refusal<R> | Conflict>;
}
