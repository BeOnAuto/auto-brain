import {
  boundedPage,
  mostExaminedInAPage,
  type Examined,
  type RecordedOrder,
  type RecordedSelection,
} from '@beonauto/operations';

import type {
  MessageLineage,
  RecordedPoint,
  RecordedStore,
  StoredPage,
  StoredPageRequest,
  StoredPlace,
} from '../event-store.ts';

export interface RecordHead extends MessageLineage {
  readonly point: RecordedPoint;
  readonly stream: string;
  readonly type: string;
  readonly recordedAt: string;
}

export interface ExaminedItem extends Examined {
  readonly point: RecordedPoint;
  readonly heads: readonly [RecordHead, ...RecordHead[]];
}

export interface ExaminationScope {
  readonly brainKey: string;
  readonly order: RecordedOrder;
  readonly examineAtMost: number;
  readonly answerAtMost: number;
  readonly types?: readonly string[];
  readonly after?: RecordedPoint;
  readonly at?: RecordedPoint;
  readonly from?: RecordedPoint;
}

export interface RecordedStatements {
  readonly firstPointSince: (brainKey: string, since: string) => Promise<RecordedPoint | undefined>;
  readonly examineRecords: (records: RecordsSelected, scope: ExaminationScope) => Promise<readonly ExaminedItem[]>;
  readonly examineRuns: (scope: ExaminationScope) => Promise<readonly ExaminedItem[]>;
  readonly dataAt: (points: readonly RecordedPoint[]) => Promise<ReadonlyMap<string, unknown>>;
}

export type RecordsSelected =
  | { readonly kind: 'brain' }
  | { readonly kind: 'streams'; readonly streams: readonly string[] }
  | { readonly kind: 'correlated'; readonly correlation: string };

export function pointKey(point: RecordedPoint): string {
  return point.join(':');
}

function scopeOf(brainKey: string, { order, limit, types, after, at }: StoredPageRequest): ExaminationScope {
  const filtering = types !== undefined;
  return {
    brainKey,
    order,
    examineAtMost: filtering ? mostExaminedInAPage : limit,
    answerAtMost: filtering ? limit + 2 : limit + 1,
    ...(types === undefined ? {} : { types }),
    ...(after === undefined ? {} : { after }),
    ...(at === undefined ? {} : { at }),
  };
}

function selectedOf(
  brainKey: string,
  selection: Exclude<RecordedSelection, { readonly kind: 'executions' }>,
): RecordsSelected {
  if (selection.kind === 'run') {
    return {
      kind: 'streams',
      streams: [`${brainKey}executions/${selection.execution}`, `${brainKey}runs/${selection.execution}`],
    };
  }
  return selection.kind === 'correlated' ? selection : { kind: 'brain' };
}

function examine(
  statements: RecordedStatements,
  selection: RecordedSelection,
  scope: ExaminationScope,
): Promise<readonly ExaminedItem[]> {
  if (selection.kind === 'executions') {
    return statements.examineRuns(scope);
  }
  return statements.examineRecords(selectedOf(scope.brainKey, selection), scope);
}

function placeOf({ point, heads: [first] }: ExaminedItem): StoredPlace {
  return { point, recordedAt: first.recordedAt };
}

async function pageWithin(
  statements: RecordedStatements,
  selection: RecordedSelection,
  limit: number,
  scope: ExaminationScope,
): Promise<StoredPage> {
  const examined = await examine(statements, selection, scope);
  const { delivered, resumeAfter, lastExamined } = boundedPage(examined, limit, scope.examineAtMost);
  const heads = delivered.flatMap((item) => item.heads);
  const data =
    heads.length === 0 ? new Map<string, unknown>() : await statements.dataAt(heads.map(({ point }) => point));
  const records = heads.map(({ point, id, causationId, correlationId, stream, type, recordedAt }) => ({
    point,
    id,
    causationId,
    correlationId,
    stream,
    type,
    recordedAt,
    data: data.get(pointKey(point)),
  }));
  return {
    records,
    ...(resumeAfter === undefined ? {} : { resumeAfter: resumeAfter.point }),
    ...(lastExamined === undefined ? {} : { lastExamined: placeOf(lastExamined) }),
  };
}

export function recordedReadingOver(statements: RecordedStatements): RecordedStore['readRecorded'] {
  return async (brainKey, selection, page) => {
    const scope = scopeOf(brainKey, page);
    if (page.since === undefined) {
      return pageWithin(statements, selection, page.limit, scope);
    }
    const from = await statements.firstPointSince(brainKey, page.since);
    return from === undefined ? { records: [] } : pageWithin(statements, selection, page.limit, { ...scope, from });
  };
}
