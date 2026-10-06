import { Data } from 'effect';

export type RecordedOrder = 'asc' | 'desc';

export type RecordedSelection =
  | { readonly kind: 'everything' }
  | { readonly kind: 'executions' }
  | { readonly kind: 'run'; readonly execution: string }
  | { readonly kind: 'correlated'; readonly correlation: string };

export interface RecordedPageRequest {
  readonly cursor?: string;
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly since?: string;
  readonly types?: readonly string[];
}

export interface RecordedEvent {
  readonly id: string;
  readonly cursor: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly stream: string;
  readonly type: string;
  readonly data: unknown;
  readonly recordedAt: string;
}

export interface ExaminedPlace {
  readonly cursor: string;
  readonly recordedAt: string;
}

export interface RecordedPage {
  readonly records: readonly RecordedEvent[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly lastExamined: ExaminedPlace | null;
}

export type InvalidCursorKind = 'malformed' | 'of_another_brain';

export class InvalidCursor extends Data.TaggedError('invalid_cursor')<{ readonly kind: InvalidCursorKind }> {}
