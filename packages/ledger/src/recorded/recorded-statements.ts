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
  readonly version: number;
  readonly type: string;
  readonly recordedAt: string;
  readonly size: number;
}

export interface ExaminedItem extends Examined {
  readonly point: RecordedPoint;
  readonly heads: readonly [RecordHead, ...RecordHead[]];
}

export interface ExaminationScope {
  readonly playbookKey: string;
  readonly order: RecordedOrder;
  readonly examineAtMost: number;
  readonly answerAtMost: number;
  readonly types?: readonly string[];
  readonly sized?: readonly string[];
  readonly after?: RecordedPoint;
  readonly at?: RecordedPoint;
  readonly from?: RecordedPoint;
}

export interface RecordedStatements {
  readonly firstPointSince: (playbookKey: string, since: string) => Promise<RecordedPoint | undefined>;
  readonly examineRecords: (records: RecordsSelected, scope: ExaminationScope) => Promise<readonly ExaminedItem[]>;
  readonly examineRuns: (scope: ExaminationScope, runs: RunsSelected) => Promise<readonly ExaminedItem[]>;
  readonly dataAt: (points: readonly RecordedPoint[]) => Promise<ReadonlyMap<string, unknown>>;
}

export type RunsSelected = Extract<RecordedSelection, { readonly kind: 'runs' }>;

export interface FieldAsked {
  readonly field: 'definition_type' | 'name';
  readonly value: string;
  readonly asWritten: string;
}

function fieldAsked(field: FieldAsked['field'], value: string | undefined): readonly FieldAsked[] {
  return value === undefined ? [] : [{ field, value, asWritten: `"${field}":${JSON.stringify(value)}` }];
}

export function fieldsAskedOf({ name, definitionType }: RunsSelected): readonly FieldAsked[] {
  return [...fieldAsked('name', name), ...fieldAsked('definition_type', definitionType)];
}

export type RecordsSelected =
  | { readonly kind: 'playbook' }
  | { readonly kind: 'streams'; readonly streams: readonly string[] }
  | { readonly kind: 'correlated'; readonly correlation: string };

export function pointKey(point: RecordedPoint): string {
  return point.join(':');
}

function asksForOneDefinition(selection: RecordedSelection): boolean {
  return selection.kind === 'runs' && fieldsAskedOf(selection).length > 0;
}

function scopeOf(
  playbookKey: string,
  selection: RecordedSelection,
  { order, limit, types, dataOf, after, at }: StoredPageRequest,
): ExaminationScope {
  const filtering = types !== undefined || asksForOneDefinition(selection);
  return {
    playbookKey,
    order,
    examineAtMost: filtering ? mostExaminedInAPage : limit,
    answerAtMost: filtering ? limit + 2 : limit + 1,
    ...(types === undefined ? {} : { types }),
    ...(dataOf === undefined ? {} : { sized: dataOf }),
    ...(after === undefined ? {} : { after }),
    ...(at === undefined ? {} : { at }),
  };
}

function selectedOf(
  playbookKey: string,
  selection: Exclude<RecordedSelection, { readonly kind: 'runs' }>,
): RecordsSelected {
  if (selection.kind === 'run') {
    return {
      kind: 'streams',
      streams: [`${playbookKey}runs/${selection.run}`, `${playbookKey}run-logs/${selection.run}`],
    };
  }
  return selection.kind === 'correlated' ? selection : { kind: 'playbook' };
}

function examine(
  statements: RecordedStatements,
  selection: RecordedSelection,
  scope: ExaminationScope,
): Promise<readonly ExaminedItem[]> {
  if (selection.kind === 'runs') {
    return statements.examineRuns(scope, selection);
  }
  return statements.examineRecords(selectedOf(scope.playbookKey, selection), scope);
}

type Loads = (head: RecordHead) => boolean;

function loadsOf(dataOf: readonly string[] | undefined): Loads {
  return dataOf === undefined ? () => true : ({ type }) => dataOf.includes(type);
}

function sizedBy(loads: Loads, dataOf: readonly string[] | undefined, item: ExaminedItem): ExaminedItem {
  return dataOf === undefined || !item.wanted
    ? item
    : { ...item, size: item.heads.filter((head) => loads(head)).reduce((sum, { size }) => sum + size, 0) };
}

function placeOf({ point, heads: [first] }: ExaminedItem): StoredPlace {
  return { point, recordedAt: first.recordedAt };
}

async function pageWithin(
  statements: RecordedStatements,
  selection: RecordedSelection,
  page: Pick<StoredPageRequest, 'limit' | 'dataOf'>,
  scope: ExaminationScope,
): Promise<StoredPage> {
  const loads = loadsOf(page.dataOf);
  const examined = (await examine(statements, selection, scope)).map((item) => sizedBy(loads, page.dataOf, item));
  const { delivered, resumeAfter, lastExamined } = boundedPage(examined, page.limit, scope.examineAtMost);
  const heads = delivered.flatMap((item) => item.heads);
  const loaded = heads.filter((head) => loads(head));
  const data =
    loaded.length === 0 ? new Map<string, unknown>() : await statements.dataAt(loaded.map(({ point }) => point));
  const records = heads.map(({ point, id, causationId, correlationId, stream, version, type, recordedAt }) => ({
    point,
    id,
    causationId,
    correlationId,
    stream,
    version,
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
  return async (playbookKey, selection, page) => {
    const scope = scopeOf(playbookKey, selection, page);
    if (page.since === undefined) {
      return pageWithin(statements, selection, page, scope);
    }
    const from = await statements.firstPointSince(playbookKey, page.since);
    return from === undefined ? { records: [] } : pageWithin(statements, selection, page, { ...scope, from });
  };
}
