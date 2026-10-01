import { Data } from 'effect';

export class Conflict extends Data.TaggedError('conflict')<{ readonly detail: string }> {}
