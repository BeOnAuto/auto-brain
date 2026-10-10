import { Schema, type Result } from 'effect';

import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type { Context } from './context.ts';

export interface TypedEvent {
  readonly type: string;
  readonly data: unknown;
}

export type Recorded<Event extends TypedEvent> = Event & { readonly context: Context };

export interface Decider<State, Command, Event extends TypedEvent, R extends DeclarableReason = never> {
  readonly initialState: State;
  readonly evolve: (state: State, recorded: Recorded<Event>) => State;
  readonly decide: (command: Command, state: State) => Result.Result<readonly Event[], Rejection<R>>;
  readonly context: (command: Command, state: State) => Context;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
}

export interface StreamState<State> {
  readonly state: State;
  readonly version: number;
}

export function factOf<const Type extends string, Data extends Schema.Top>(type: Type, data: Data) {
  return Schema.Struct({ type: Schema.Literal(type), data });
}

export function recordedWith<Event extends TypedEvent>(context: Context): (event: Event) => Recorded<Event> {
  return (event) => ({ ...event, context });
}
