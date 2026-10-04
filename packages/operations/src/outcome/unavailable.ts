import { Data, Schema } from 'effect';

export const UnavailableKindSchema = Schema.Literals(['model_not_offered']);

export type UnavailableKind = typeof UnavailableKindSchema.Type;

export class Unavailable extends Data.TaggedError('unavailable')<{
  readonly detail: string;
  readonly kind?: UnavailableKind;
}> {}
