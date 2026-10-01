import { Data } from 'effect';

export class Unavailable extends Data.TaggedError('unavailable')<{ readonly detail: string }> {}
