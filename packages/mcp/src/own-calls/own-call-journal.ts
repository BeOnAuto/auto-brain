import { messageIdOf, type Decider, type Lineage, type StreamWriter, type TypedEvent } from '@beonauto/operations';
import { DateTime, Effect, Exit, Ref } from 'effect';

import type { CallStarted } from '../calls/call-facts.ts';
import type { CallJournal, NumberedAnswer } from '../calls/recorded-calls.ts';
import type { OwnCallTurn } from './own-call-decider.ts';

interface Recorded {
  readonly by: string;
  readonly at: string;
}

export interface OwnCallKind<Event extends TypedEvent> {
  readonly decider: Decider<OwnCallTurn<Event>, Event, Event, 'conflict'>;
  readonly started: (fact: CallStarted, recorded: Recorded) => Event;
  readonly answered: (fact: NumberedAnswer, recorded: Recorded) => Event;
}

export interface OwnCallPlace {
  readonly writer: Pick<StreamWriter, 'execute'>;
  readonly stream: string;
  readonly inTheBrain: string;
  readonly by: string;
  readonly lineage: Lineage;
}

const theOnlyCall = 1;

export function ownCallJournal<Event extends TypedEvent>(kind: OwnCallKind<Event>, place: OwnCallPlace): CallJournal {
  const startId = Ref.makeUnsafe<string | null>(null);
  const appended = (event: (recorded: Recorded) => Event, causationId: string | null) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      const { version } = yield* place.writer.execute(place.stream, kind.decider, event({ by: place.by, at }), {
        ...place.lineage,
        causationId,
      });
      return messageIdOf(place.inTheBrain, version);
    });
  return {
    started: (fact) =>
      appended((recorded) => kind.started(fact, recorded), place.lineage.causationId).pipe(
        Effect.orDie,
        Effect.flatMap((id) => Ref.set(startId, id)),
        Effect.as(theOnlyCall),
      ),
    answered: (fact) =>
      Effect.flatMap(Ref.get(startId), (causationId) =>
        appended((recorded) => kind.answered(fact, recorded), causationId).pipe(
          Effect.exit,
          Effect.map(Exit.isSuccess),
        ),
      ),
  };
}
