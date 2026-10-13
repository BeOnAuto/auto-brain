import { Data } from 'effect';

export class UnusableProviderError extends Data.TaggedError('UnusableProviderError')<{ readonly message: string }> {}
