import { Data, Schema } from 'effect';

export const UnavailableKindSchema = Schema.Literals(['model_not_offered']);

export type UnavailableKind = typeof UnavailableKindSchema.Type;

export const UnavailableBecauseSchema = Schema.Literals(['provider_not_configured', 'model_not_allowed']);

export type UnavailableBecause = typeof UnavailableBecauseSchema.Type;

export class Unavailable extends Data.TaggedError('unavailable')<{
  readonly detail: string;
  readonly kind?: UnavailableKind;
  readonly because?: UnavailableBecause;
}> {}
