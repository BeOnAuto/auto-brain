import { Data } from 'effect';

export class InvalidLocalModeError extends Data.TaggedError('InvalidLocalModeError')<{ readonly message: string }> {}
