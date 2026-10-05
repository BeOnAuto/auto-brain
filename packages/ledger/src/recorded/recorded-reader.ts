import {
  InvalidCursor,
  streamPrefixOfBrain,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
} from '@beonauto/operations';
import { Effect, Option } from 'effect';

import type { RecordedPoint, RecordedStore, StoredPage, StoredPageRequest } from '../event-store.ts';
import { cursorOf, pointOf } from './cursor.ts';

function storedRequestOf(
  { cursor, ...page }: RecordedPageRequest,
  brainKey: string,
  pointLength: number,
): Effect.Effect<StoredPageRequest, InvalidCursor> {
  if (cursor === undefined) {
    return Effect.succeed(page);
  }
  return Option.match(pointOf(cursor, brainKey, pointLength), {
    onNone: () => Effect.fail(new InvalidCursor()),
    onSome: (after: RecordedPoint) => Effect.succeed({ ...page, after }),
  });
}

function recordedPageOf(brainKey: string): (stored: StoredPage) => RecordedPage {
  return ({ records, resumeAfter }) => ({
    records: records.map(({ point, stream, type, data, recordedAt }) => ({
      id: cursorOf(brainKey, point),
      stream,
      type,
      data,
      recordedAt,
    })),
    hasMore: resumeAfter !== undefined,
    nextCursor: resumeAfter === undefined ? null : cursorOf(brainKey, resumeAfter),
  });
}

export function recordedReaderOf(store: RecordedStore): RecordedReader['readRecorded'] {
  return (brain, selection, page) => {
    const brainKey = streamPrefixOfBrain(brain);
    return storedRequestOf(page, brainKey, store.pointLength).pipe(
      Effect.flatMap((request) => Effect.promise(() => store.readRecorded(brainKey, selection, request))),
      Effect.map(recordedPageOf(brainKey)),
    );
  };
}
