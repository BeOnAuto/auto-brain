import { playbookEventOf, definitionTypeStreamOf, type CloudEvent } from '@beonauto/definitions';
import type { EventStore, StoredPage, StoredPlace } from '@beonauto/ledger';

import { recordsInAPage } from '../projector/projector-settings.ts';
import type { Point } from '../views/view-points.ts';

export interface PageEvent {
  readonly point: Point;
  readonly recordedAt: string;
  readonly record: string;
  readonly event: CloudEvent;
}

interface PassedOver {
  readonly record: string;
  readonly reason: 'unreadable';
}

export interface ReadPage {
  readonly events: readonly PageEvent[];
  readonly definitionsSeen: boolean;
  readonly passedOver: readonly PassedOver[];
  readonly lastExamined: StoredPlace | undefined;
  readonly atTheEnd: boolean;
}

interface PageRead {
  readonly playbookKey: string;
  readonly after: Point | undefined;
  readonly types: readonly string[];
  readonly definitionType: string;
}

type StoredRecord = StoredPage['records'][number];

const definitionTypes = ['definition_created', 'definition_updated', 'definition_retired'];

const factTypes: ReadonlySet<string> = new Set([
  'run_started',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  ...definitionTypes,
]);

export function typesToRead(named: readonly string[]): readonly string[] {
  const published = named.some((type) => !factTypes.has(type)) ? ['event_published'] : [];
  const read = new Set([...named.filter((type) => factTypes.has(type)), ...published, ...definitionTypes]);
  return [...read].toSorted();
}

function eventOf(playbookKey: string, record: StoredRecord): CloudEvent | undefined {
  const { id, causationId, correlationId, version, type, data, recordedAt } = record;
  const stream = record.stream.slice(playbookKey.length);
  return playbookEventOf({ id, cursor: '', causationId, correlationId, stream, version, type, data, recordedAt });
}

function hasAMoment({ time }: CloudEvent): boolean {
  return time === undefined || Number.isFinite(Date.parse(time));
}

function placedOf(playbookKey: string, record: StoredRecord): PageEvent | PassedOver {
  const event = eventOf(playbookKey, record);
  return event === undefined || !hasAMoment(event)
    ? { record: record.id, reason: 'unreadable' }
    : { point: record.point, recordedAt: record.recordedAt, record: record.id, event };
}

function isPageEvent(placed: PageEvent | PassedOver): placed is PageEvent {
  return 'event' in placed;
}

function isPassedOver(placed: PageEvent | PassedOver): placed is PassedOver {
  return 'reason' in placed;
}

export async function readPage(
  store: EventStore,
  { playbookKey, after, types, definitionType }: PageRead,
): Promise<ReadPage> {
  const page = await store.readRecorded(
    playbookKey,
    { kind: 'everything' },
    { order: 'asc', limit: recordsInAPage, types, ...(after === undefined ? {} : { after }) },
  );
  const placed = page.records.map((record) => placedOf(playbookKey, record));
  const definitions = `${playbookKey}${definitionTypeStreamOf(definitionType)}`;
  return {
    events: placed.filter((each) => isPageEvent(each)),
    definitionsSeen: page.records.some(({ stream }) => stream === definitions),
    passedOver: placed.filter((each) => isPassedOver(each)),
    lastExamined: page.lastExamined,
    atTheEnd: page.resumeAfter === undefined,
  };
}
