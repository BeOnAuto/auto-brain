import type { Presenter } from '@beonauto/operations';
import { Schema } from 'effect';

interface Fact<Type extends string> {
  readonly type: Type;
  readonly at: string;
}

export interface Account {
  readonly summary: string;
  readonly data: Schema.JsonObject;
}

export interface EventPresenting<Type extends string, Event extends Fact<Type>> {
  readonly streamKind: string;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
  readonly publicNames: Readonly<Record<Type, readonly [string]>>;
  readonly account: (event: Event, subject: string) => Account;
}

export function eventPresenter<Type extends string, Event extends Fact<Type>>({
  streamKind,
  eventSchema,
  publicNames,
  account,
}: EventPresenting<Type, Event>): Presenter {
  const decode = Schema.decodeUnknownSync(Schema.toCodecJson(eventSchema));
  const subjectStart = streamKind.length + 1;
  return {
    streamKind,
    publicNames,
    present: ({ id, cursor, causationId, stream, data }) => {
      const event = decode(data);
      const [type] = publicNames[event.type];
      return [
        { id, cursor, causation_id: causationId, at: event.at, type, ...account(event, stream.slice(subjectStart)) },
      ];
    },
  };
}
