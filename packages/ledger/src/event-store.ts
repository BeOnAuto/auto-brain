import type { RecordedOrder, RecordedSelection } from '@beonauto/operations';
import type { Schema } from 'effect';

export interface EncodedEvent {
  readonly type: string;
  readonly data: Schema.JsonObject;
}

export interface RecordedStream {
  readonly version: number;
  readonly events: readonly unknown[];
}

export type RecordedPoint = readonly string[];

export interface StoredPageRequest {
  readonly after?: RecordedPoint;
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly since?: string;
  readonly types?: readonly string[];
}

interface StoredRecord {
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
  readonly append: (stream: string, events: readonly EncodedEvent[], expectedVersion: number) => Promise<void>;
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
