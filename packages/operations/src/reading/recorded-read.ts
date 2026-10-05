import { Data } from 'effect';

export type RecordedOrder = 'asc' | 'desc';

export type RecordedSelection =
  | { readonly kind: 'everything' }
  | { readonly kind: 'executions' }
  | { readonly kind: 'run'; readonly execution: string };

export interface RecordedPageRequest {
  readonly cursor?: string;
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly since?: string;
  readonly types?: readonly string[];
}

export interface RecordedEvent {
  readonly id: string;
  readonly stream: string;
  readonly type: string;
  readonly data: unknown;
  readonly recordedAt: string;
}

export interface RecordedPage {
  readonly records: readonly RecordedEvent[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export class InvalidCursor extends Data.TaggedError('invalid_cursor') {}
