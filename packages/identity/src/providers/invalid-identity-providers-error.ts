import { Data } from 'effect';

export class InvalidIdentityProvidersError extends Data.TaggedError('InvalidIdentityProvidersError')<{
  readonly message: string;
}> {}
