import { strictRecordedDecoder, type Presenter, type Recorded, type TypedEvent } from '@beonauto/operations';
import type { Schema } from 'effect';

export interface Account {
  readonly summary: string;
  readonly data: Schema.JsonObject;
}

export interface EventPresenting<Event extends TypedEvent> {
  readonly streamKind: string;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
  readonly types: readonly Event['type'][];
  readonly account: (event: Recorded<Event>, subject: string) => Account;
}

export function eventPresenter<Event extends TypedEvent>({
  streamKind,
  eventSchema,
  types,
  account,
}: EventPresenting<Event>): Presenter {
  const decode = strictRecordedDecoder(eventSchema);
  const subjectStart = streamKind.length + 1;
  return {
    streamKind,
    publicNames: Object.fromEntries(types.map((type) => [type, [type]])),
    present: (recorded) => {
      const event = decode(recorded);
      return [{ type: event.type, ...account(event, recorded.stream.slice(subjectStart)) }];
    },
  };
}
