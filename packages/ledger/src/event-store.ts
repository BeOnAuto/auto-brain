import type { Lineage, RecordedOrder, RecordedSelection } from '@beonauto/operations';
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
}

interface StoredRecord extends MessageLineage {
  readonly point: RecordedPoint;
  readonly stream: string;
  readonly type: string;
  readonly data: unknown;
  readonly recordedAt: string;
}

export interface StoredPage {
  readonly records: readonly StoredRecord[];
  readonly resumeAfter?: RecordedPoint;
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

export interface RecordedStore {
  readonly pointLength: number;
  readonly readRecorded: (
    brainKey: string,
    selection: RecordedSelection,
    page: StoredPageRequest,
  ) => Promise<StoredPage>;
}

export interface EventStore extends StreamStore, RecordedStore {}
