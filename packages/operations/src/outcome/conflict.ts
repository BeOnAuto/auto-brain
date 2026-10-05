import { Data } from 'effect';

export type ConflictKind = 'taken' | 'retired' | 'concurrent_change' | 'unworkable' | 'tools_called';

export class Conflict extends Data.TaggedError('conflict')<{
  readonly detail: string;
  readonly kind?: ConflictKind;
}> {}
