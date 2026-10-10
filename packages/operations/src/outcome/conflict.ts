import { Data, Schema } from 'effect';

import type { RejectionBecause } from './rejection-because.ts';

export const ConflictKindSchema = Schema.Literals([
  'taken',
  'retired',
  'concurrent_change',
  'unworkable',
  'stalled',
  'tools_called',
  'effect_unknown',
  'oversized',
]);

export type ConflictKind = typeof ConflictKindSchema.Type;

export class Conflict extends Data.TaggedError('conflict')<{
  readonly detail: string;
  readonly kind?: ConflictKind;
  readonly because?: RejectionBecause;
  readonly record?: Schema.JsonObject;
}> {}
