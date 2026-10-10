import { Data } from 'effect';

import type { Context } from '../ledger/context.ts';

export type RecordedOrder = 'asc' | 'desc';

export type RecordedSelection =
  | { readonly kind: 'everything' }
  | {
      readonly kind: 'runs';
      readonly notBeginningWith?: readonly string[];
      readonly definitionType?: string;
      readonly name?: string;
    }
  | { readonly kind: 'run'; readonly run: string }
  | { readonly kind: 'correlated'; readonly correlation: string };

export interface RecordedPageRequest {
  readonly cursor?: string;
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly since?: string;
  readonly types?: readonly string[];
  readonly dataOf?: readonly string[];
}

export interface Trace {
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface RecordedEvent extends Trace {
  readonly id: string;
  readonly cursor: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly stream: string;
  readonly version: number;
  readonly globalPosition: number;
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
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
