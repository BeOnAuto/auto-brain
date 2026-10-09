import type { Conflict } from '@beonauto/operations';
import { CallKeySchema, listenerFilterOf, matchEvent, type CallKey, type Submission } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import {
  DeliveryFailed,
  deliverySweeps,
  type RecordConsumer,
  type Delivery,
  type FollowedRecord,
} from '../follower/consumers.ts';
import { listenersOfType, type ListenerPlace, type MatchedListener } from '../listeners/listener-rows.ts';
import { addressOfRun } from '../runs/run-address.ts';
import type { RefuseReaction } from './refusals.ts';

interface Offer {
  readonly runKey: string;
  readonly key: string;
  readonly listener: CallKey;
  readonly event: FollowedRecord['event']['event'];
}

export interface OfferParts {
  readonly database: HostDatabase;
  readonly refusals: RefuseReaction;
  readonly offer: (offer: Offer) => Effect.Effect<Submission, Conflict | Readonly<{ detail: string }>>;
  readonly declined: (runKey: string, detail: string) => Effect.Effect<void>;
  readonly now: () => number;
}

const PlaceSchema = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

const ListenerKeySchema = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.Int]));

const FiltersSchema = Schema.fromJsonString(Schema.Array(Schema.JsonObject));

const nowhere: ListenerPlace = { runKey: '', listener: '' };

function placeOf(after: string | undefined): ListenerPlace {
  if (after === undefined) {
    return nowhere;
  }
  const [runKey, listener] = Schema.decodeUnknownSync(PlaceSchema)(after);
  return { runKey, listener };
}

function keyOf(row: MatchedListener): string {
  return JSON.stringify([row.run_id, row.listener]);
}

function listenerKeyOf(text: string): CallKey {
  const [runId, reference, run] = Schema.decodeUnknownSync(ListenerKeySchema)(text);
  return Schema.decodeUnknownSync(CallKeySchema)({ runId, reference, run });
}

function accepts(row: MatchedListener, { event }: FollowedRecord, now: number): boolean {
  return Schema.decodeUnknownSync(FiltersSchema)(row.filters).some((attributes) => {
    const filter = listenerFilterOf(attributes, row.listener);
    return filter !== undefined && matchEvent(filter, event.event, now) === true;
  });
}

function emittedByTheRun(row: MatchedListener, { event }: FollowedRecord): boolean {
  return event.emitter?.runId === addressOfRun(row.run_id).runId;
}

function offerOf(parts: OfferParts, row: MatchedListener, followed: FollowedRecord): Delivery {
  return {
    key: keyOf(row),
    workflow: row.workflow,
    deliver: parts
      .offer({
        runKey: row.run_id,
        key: followed.record.id,
        listener: listenerKeyOf(row.listener),
        event: followed.event.event,
      })
      .pipe(
        Effect.flatMap(({ declined }) => (declined === undefined ? Effect.void : parts.declined(row.run_id, declined))),
        Effect.mapError(({ detail }: Readonly<{ detail: string }>) => new DeliveryFailed({ detail })),
      ),
  };
}

export function listenerOffers(parts: OfferParts): RecordConsumer {
  return {
    name: 'listener_offers',
    skippedAfterSweeps: deliverySweeps,
    batchOf: (followed, after, most) =>
      Effect.map(
        listenersOfType(parts.database, {
          brainKey: followed.brainKey,
          type: followed.event.event.type,
          after: placeOf(after),
          limit: most + 1,
        }),
        (rows) => {
          const taken = rows.slice(0, most);
          const now = parts.now();
          const lastTaken = taken.at(-1);
          return {
            deliveries: taken
              .filter((row) => !emittedByTheRun(row, followed) && accepts(row, followed, now))
              .map((row) => offerOf(parts, row, followed)),
            through: lastTaken === undefined ? undefined : keyOf(lastTaken),
            more: rows.length > most,
          };
        },
      ),
    skipped: ({ brainKey }, { workflow }, detail) =>
      parts.refusals.refuse(brainKey, workflow, `An event could not be offered to a run waiting for it: ${detail}`),
  };
}
