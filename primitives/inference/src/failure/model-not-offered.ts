import { Data } from 'effect';

export class ModelNotOffered extends Data.TaggedError('model_not_offered')<{
  readonly detail: string;
  readonly provider: string;
  readonly offered: readonly string[];
}> {}
