import type { Conflict } from '@beonauto/operations';
import { CallKeySchema, listenerFilterOf, type CallKey, type Submission } from '@beonauto/workflow-engine';
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
import { groupVerdicts, type MatchedFilter, type MatchFilters } from './filter-matching.ts';
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
  readonly match: MatchFilters;
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
  return JSON.stringify([row.run_key, row.listener]);
}

function listenerKeyOf(text: string): CallKey {
  const [runId, reference, run] = Schema.decodeUnknownSync(ListenerKeySchema)(text);
  return Schema.decodeUnknownSync(CallKeySchema)({ runId, reference, run });
}

function filtersOf(row: MatchedListener): readonly MatchedFilter[] {
  return Schema.decodeUnknownSync(FiltersSchema)(row.filters).flatMap((attributes) => {
    const filter = listenerFilterOf(attributes, row.listener);
    return filter === undefined ? [] : [filter];
  });
}

function accepting(
  parts: OfferParts,
  rows: readonly MatchedListener[],
  { event }: FollowedRecord,
): Effect.Effect<readonly boolean[]> {
  const groups = rows.map((row) => filtersOf(row));
  return Effect.map(groupVerdicts(parts.match, groups, event.event, parts.now()), (verdicts) =>
    verdicts.map((each) => each.includes(true)),
  );
}

function emittedByTheRun(row: MatchedListener, { event }: FollowedRecord): boolean {
  return event.emitter?.runId === addressOfRun(row.run_key).runId;
}

function offerOf(parts: OfferParts, row: MatchedListener, followed: FollowedRecord): Delivery {
  return {
    key: keyOf(row),
    workflow: row.workflow,
    deliver: parts
      .offer({
        runKey: row.run_key,
        key: followed.record.id,
        listener: listenerKeyOf(row.listener),
        event: followed.event.event,
      })
      .pipe(
        Effect.flatMap(({ declined }) =>
          declined === undefined ? Effect.void : parts.declined(row.run_key, declined),
        ),
        Effect.mapError(({ detail }: Readonly<{ detail: string }>) => new DeliveryFailed({ detail })),
      ),
  };
}

export function listenerOffers(parts: OfferParts): RecordConsumer {
  return {
    name: 'listener_offers',
    skippedAfterSweeps: deliverySweeps,
    batchOf: (followed, after, most) =>
      Effect.gen(function* () {
        const rows = yield* listenersOfType(parts.database, {
          brainKey: followed.brainKey,
          type: followed.event.event.type,
          after: placeOf(after),
          limit: most + 1,
        });
        const taken = rows.slice(0, most);
        const others = taken.filter((row) => !emittedByTheRun(row, followed));
        const accepted = yield* accepting(parts, others, followed);
        const lastTaken = taken.at(-1);
        return {
          deliveries: others.filter((_, index) => accepted[index] === true).map((row) => offerOf(parts, row, followed)),
          through: lastTaken === undefined ? undefined : keyOf(lastTaken),
          more: rows.length > most,
        };
      }),
    skipped: ({ brainKey }, { workflow }, detail) =>
      parts.refusals.refuse(brainKey, workflow, `An event could not be offered to a run waiting for it: ${detail}`),
  };
}
