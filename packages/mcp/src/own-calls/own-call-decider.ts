import { Conflict, type Decider, type TypedEvent } from '@beonauto/operations';
import { Result, type Schema } from 'effect';

export type OwnCallTurn<Event extends TypedEvent> = 'none' | Event['type'];

export interface OwnCallTurns<Event extends TypedEvent> {
  readonly first: readonly Event['type'][];
  readonly after: Readonly<Partial<Record<Event['type'], Event['type']>>>;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
  readonly outOfTurn: string;
}

export function ownCallDecider<Event extends TypedEvent>({
  first,
  after,
  eventSchema,
  outOfTurn,
}: OwnCallTurns<Event>): Decider<OwnCallTurn<Event>, Event, Event, 'conflict'> {
  const refused = new Conflict({ detail: outOfTurn });
  const takes = (state: OwnCallTurn<Event>, type: Event['type']): boolean =>
    state === 'none' ? first.includes(type) : after[state] === type;
  return {
    initialState: 'none',
    evolve: (_state, event) => event.type,
    decide: (event, state) => (takes(state, event.type) ? Result.succeed([event]) : Result.fail(refused)),
    eventSchema,
  };
}
