import { Effect, Option } from 'effect';

import {
  InvalidCursor,
  boundedPage,
  mostExaminedInAPage,
  streamPrefixOfBrain,
  type BrainAddress,
  type RecordedEvent,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
  type RecordedSelection,
} from '../index.ts';
import { cursorOfParts, partsOfCursor, type CursorPart } from '../reading/cursor-parts.ts';

export interface MemoryRecord {
  readonly position: number;
  readonly id: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly stream: string;
  readonly streamPosition: number;
  readonly type: string;
  readonly data: unknown;
  readonly recordedAt: string;
}

interface ExaminedRun {
  readonly examined: number;
  readonly wanted: boolean;
  readonly size: number;
  readonly position: number;
  readonly heads: readonly MemoryRecord[];
}

interface Resumed {
  readonly position: number;
  readonly inclusive: boolean;
}

const positionPattern = /^[1-9]\d{0,14}$/u;

const utf8 = new TextEncoder();

function brainKeyOf(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments.length > 3 ? `${segments.slice(0, 3).join('/')}/` : undefined;
}

function isPositionPart(part: CursorPart | undefined): part is string {
  return typeof part === 'string' && positionPattern.test(part);
}

function resumedOf(key: string): (parts: readonly CursorPart[]) => Effect.Effect<Resumed, InvalidCursor> {
  return ([cursorKey, at, within, ...rest]) => {
    if (typeof cursorKey !== 'string' || !isPositionPart(at) || typeof within === 'string' || rest.length > 0) {
      return Effect.fail(new InvalidCursor({ kind: 'malformed' }));
    }
    return cursorKey === key
      ? Effect.succeed({ position: Number(at), inclusive: within !== undefined })
      : Effect.fail(new InvalidCursor({ kind: 'of_another_brain' }));
  };
}

function resumedFrom({ cursor, order }: RecordedPageRequest, key: string): Effect.Effect<Resumed, InvalidCursor> {
  if (cursor === undefined) {
    return Effect.succeed({ position: order === 'asc' ? 0 : Number.POSITIVE_INFINITY, inclusive: false });
  }
  return Option.match(partsOfCursor(cursor), {
    onNone: () => Effect.fail(new InvalidCursor({ kind: 'malformed' })),
    onSome: resumedOf(key),
  });
}

function sizeOf({ data }: MemoryRecord): number {
  return utf8.encode(JSON.stringify(data)).byteLength;
}

function inSelection(key: string, selection: RecordedSelection): (record: MemoryRecord) => boolean {
  if (selection.kind === 'run') {
    const streams = new Set([`${key}executions/${selection.execution}`, `${key}runs/${selection.execution}`]);
    return ({ stream }) => streams.has(stream);
  }
  if (selection.kind === 'executions') {
    return ({ stream, streamPosition }) => streamPosition === 1 && stream.startsWith(`${key}executions/`);
  }
  return selection.kind === 'correlated' ? ({ correlationId }) => correlationId === selection.correlation : () => true;
}

function byTimeThenPosition(left: MemoryRecord, right: MemoryRecord): number {
  const apart = Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
  return apart === 0 ? left.position - right.position : apart;
}

function firstSince(inBrain: readonly MemoryRecord[], since: string | undefined): number | undefined {
  if (since === undefined) {
    return 0;
  }
  const from = Date.parse(since);
  return inBrain
    .filter(({ recordedAt }) => Date.parse(recordedAt) >= from)
    .toSorted(byTimeThenPosition)
    .at(0)?.position;
}

function examinedRecords(
  candidates: readonly MemoryRecord[],
  { types }: RecordedPageRequest,
  examineAtMost: number,
): readonly ExaminedRun[] {
  return candidates.slice(0, examineAtMost + 1).map((record, index) => {
    const wanted = types === undefined || types.includes(record.type);
    return {
      examined: index + 1,
      wanted,
      size: wanted ? sizeOf(record) : 0,
      position: record.position,
      heads: [record],
    };
  });
}

function examinedRuns(
  log: readonly MemoryRecord[],
  candidates: readonly MemoryRecord[],
  { types }: RecordedPageRequest,
): readonly ExaminedRun[] {
  return candidates.slice(0, mostExaminedInAPage + 1).map((first, index) => {
    const latest = log.reduce((last, record) => (record.stream === first.stream ? record : last), first);
    const heads = latest === first ? [first] : [first, latest];
    const wanted = types === undefined || types.includes(latest.type);
    const size = heads.reduce((total, head) => total + sizeOf(head), 0);
    return { examined: index + 1, wanted, size: wanted ? size : 0, position: first.position, heads };
  });
}

function cursorAt(key: string, at: number): string {
  return cursorOfParts([key, String(at)]);
}

function recordedOf(key: string, record: MemoryRecord): RecordedEvent {
  const { id, causationId, correlationId, stream, type, data, recordedAt } = record;
  return { id, cursor: cursorAt(key, record.position), causationId, correlationId, stream, type, data, recordedAt };
}

function beyond({ position, inclusive }: Resumed, order: RecordedPageRequest['order']): (at: number) => boolean {
  if (order === 'asc') {
    return (at) => (inclusive ? at >= position : at > position);
  }
  return (at) => (inclusive ? at <= position : at < position);
}

function pageOf(
  log: readonly MemoryRecord[],
  key: string,
  selection: RecordedSelection,
  page: RecordedPageRequest,
): (resumed: Resumed) => RecordedPage {
  return (resumed) => {
    const isBeyond = beyond(resumed, page.order);
    const inBrain = log.filter(({ stream }) => brainKeyOf(stream) === key);
    const from = firstSince(inBrain, page.since) ?? Number.POSITIVE_INFINITY;
    const inOrder = page.order === 'asc' ? inBrain : inBrain.toReversed();
    const candidates = inOrder.filter(
      (record) => inSelection(key, selection)(record) && record.position >= from && isBeyond(record.position),
    );
    const cap = page.types === undefined && selection.kind !== 'executions' ? page.limit : mostExaminedInAPage;
    const examined =
      selection.kind === 'executions' ? examinedRuns(log, candidates, page) : examinedRecords(candidates, page, cap);
    const { delivered, resumeAfter } = boundedPage(examined, page.limit, cap);
    const nextCursor = resumeAfter === undefined ? null : cursorAt(key, resumeAfter.position);
    return {
      records: delivered.flatMap(({ heads }) => heads.map((head) => recordedOf(key, head))),
      hasMore: nextCursor !== null,
      nextCursor,
    };
  };
}

export function memoryRecordedReader(log: readonly MemoryRecord[]): RecordedReader['readRecorded'] {
  return (brain: BrainAddress, selection, page) =>
    Effect.suspend(() => {
      const key = streamPrefixOfBrain(brain);
      return resumedFrom(page, key).pipe(Effect.map(pageOf(log, key, selection, page)));
    });
}
