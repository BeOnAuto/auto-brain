import { Data, Schema } from 'effect';

export const ConflictKindSchema = Schema.Literals([
  'taken',
  'retired',
  'concurrent_change',
  'unworkable',
  'stalled',
  'tools_called',
]);

export type ConflictKind = typeof ConflictKindSchema.Type;

export class Conflict extends Data.TaggedError('conflict')<{
  readonly detail: string;
  readonly kind?: ConflictKind;
  readonly record?: Schema.JsonObject;
}> {}
