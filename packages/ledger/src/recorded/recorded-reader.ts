import {
  InvalidCursor,
  streamPrefixOfBrain,
  type RecordedEvent,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
} from '@beonauto/operations';
import { Effect, Result } from 'effect';

import type { RecordedStore, StoredPage, StoredPageRequest, StoredRecord } from '../event-store.ts';
import { cursorOf, pointOf, type CursorPoint } from './cursor.ts';

function storedRequestOf(
  { cursor, ...page }: RecordedPageRequest,
  brainKey: string,
  pointLength: number,
): Effect.Effect<StoredPageRequest, InvalidCursor> {
  if (cursor === undefined) {
    return Effect.succeed(page);
  }
  return Result.match(pointOf(cursor, brainKey, pointLength), {
    onFailure: (kind) => Effect.fail(new InvalidCursor({ kind })),
    onSuccess: ({ point, within }: CursorPoint) =>
      Effect.succeed(within ? { ...page, at: point } : { ...page, after: point }),
  });
}

function recordedEventOf(brainKey: string): (stored: StoredRecord) => RecordedEvent {
  return ({
    point,
    id,
    causationId,
    correlationId,
    stream,
    version,
    globalPosition,
    type,
    data,
    metadata,
    recordedAt,
  }) => ({
    id,
    cursor: cursorOf(brainKey, point),
    causationId,
    correlationId,
    stream,
    version,
    globalPosition,
    type,
    data,
    context: metadata.context,
    ...(metadata.traceId === undefined ? {} : { traceId: metadata.traceId }),
    ...(metadata.spanId === undefined ? {} : { spanId: metadata.spanId }),
    recordedAt,
  });
}

function recordedPageOf(brainKey: string): (stored: StoredPage) => RecordedPage {
  const recorded = recordedEventOf(brainKey);
  return ({ records, resumeAfter, lastExamined }) => ({
    records: records.map((record) => recorded(record)),
    hasMore: resumeAfter !== undefined,
    nextCursor: resumeAfter === undefined ? null : cursorOf(brainKey, resumeAfter),
    lastExamined:
      lastExamined === undefined
        ? null
        : { cursor: cursorOf(brainKey, lastExamined.point), recordedAt: lastExamined.recordedAt },
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

export function recordedEventReaderOf(store: RecordedStore): RecordedReader['readRecordedEvent'] {
  return (brain, id) => {
    const brainKey = streamPrefixOfBrain(brain);
    return Effect.promise(() => store.readRecordedEvent(brainKey, id)).pipe(
      Effect.map((stored) => (stored === undefined ? undefined : recordedEventOf(brainKey)(stored))),
    );
  };
}
