import { messageIdOf, type Decider, type Lineage, type StreamWriter, type TypedEvent } from '@beonauto/operations';
import { DateTime, Effect, Exit, Ref } from 'effect';

import type { CallEnded, CallStarted } from '../calls/call-facts.ts';
import type { CallJournal } from '../calls/recorded-calls.ts';
import type { OwnCall, OwnCallTurn } from './own-call-decider.ts';

export interface OwnCallKind<Event extends TypedEvent> {
  readonly decider: Decider<OwnCallTurn<Event>, OwnCall<Event>, Event, 'conflict'>;
  readonly started: (fact: CallStarted) => Event;
  readonly ended: (fact: CallEnded) => Event;
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
  const appended = (event: Event, causationId: string | null) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      const { version } = yield* place.writer.execute(
        place.stream,
        kind.decider,
        { event, context: { at, by: place.by } },
        { ...place.lineage, causationId },
      );
      return messageIdOf(place.inTheBrain, version);
    });
  return {
    started: (fact) =>
      appended(kind.started(fact), place.lineage.causationId).pipe(
        Effect.orDie,
        Effect.flatMap((id) => Ref.set(startId, id)),
        Effect.as(theOnlyCall),
      ),
    ended: (_number, fact) =>
      Effect.flatMap(Ref.get(startId), (causationId) =>
        appended(kind.ended(fact), causationId).pipe(Effect.exit, Effect.map(Exit.isSuccess)),
      ),
  };
}
