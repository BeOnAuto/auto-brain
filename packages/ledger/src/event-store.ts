import type {
  ProjectionAdvancer,
  ProjectionReader,
  Lineage,
  RecordedOrder,
  RecordedSelection,
  RunOutcomeGroup,
  RunOutcomeSelection,
  RunOutcomeWindow,
} from '@beonauto/operations';
import type { SQL } from '@event-driven-io/dumbo';
import type { Schema } from 'effect';

export interface EncodedEvent {
  readonly type: string;
  readonly data: Schema.JsonObject;
}

export interface MessageLineage extends Lineage {
  readonly id: string;
}

export interface RecordedStream {
  readonly version: number;
  readonly events: readonly unknown[];
  readonly lineages: readonly MessageLineage[];
}

export type RecordedPoint = readonly string[];

export interface StoredPageRequest {
  readonly after?: RecordedPoint;
  readonly at?: RecordedPoint;
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly since?: string;
  readonly types?: readonly string[];
  readonly dataOf?: readonly string[];
}

interface StoredRecord extends MessageLineage {
  readonly point: RecordedPoint;
  readonly stream: string;
  readonly version: number;
  readonly type: string;
  readonly data: unknown;
  readonly recordedAt: string;
}

export interface StoredPlace {
  readonly point: RecordedPoint;
  readonly recordedAt: string;
}

export interface StoredPage {
  readonly records: readonly StoredRecord[];
  readonly resumeAfter?: RecordedPoint;
  readonly lastExamined?: StoredPlace;
}

export interface StreamStore {
  readonly mostEventsInOneAppend: number;
  readonly read: (stream: string, after?: number) => Promise<RecordedStream>;
  readonly append: (
    stream: string,
    events: readonly EncodedEvent[],
    expectedVersion: number,
    lineage?: Lineage,
  ) => Promise<void>;
  readonly migrate: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface AppendedStreams {
  readonly streams: readonly string[];
  readonly through: RecordedPoint;
  readonly more: boolean;
}

export interface RecordedStore {
  readonly pointLength: number;
  readonly readRecorded: (
    brainKey: string,
    selection: RecordedSelection,
    page: StoredPageRequest,
  ) => Promise<StoredPage>;
  readonly readAppended: (after: RecordedPoint | undefined, most: number) => Promise<AppendedStreams>;
}

export interface DefinitionStream {
  readonly stream: string;
  readonly version: number;
}

export interface DefinitionStreamsStore {
  readonly definitionStreams: (definitionType: string) => Promise<readonly DefinitionStream[]>;
}

export interface EventStore extends StreamStore, RecordedStore, DefinitionStreamsStore {}

export interface RunOutcomesStore {
  readonly readRunOutcomes: (
    brainKey: string,
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Promise<readonly RunOutcomeGroup[]>;
}

export interface LedgerStore extends EventStore, RunOutcomesStore, ProjectionReader, ProjectionAdvancer {}

export interface StatementExecutor {
  readonly query: (sql: SQL) => Promise<{ readonly rows: readonly unknown[] }>;
  readonly command: (sql: SQL) => Promise<unknown>;
}
