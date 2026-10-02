import { Data } from 'effect';

export class StartupError extends Data.TaggedError('StartupError')<{
  readonly message: string;
}> {}
