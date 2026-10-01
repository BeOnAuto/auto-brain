import { Data } from 'effect';

export class Cancelled extends Data.TaggedError('cancelled')<{
  readonly detail: string;
  readonly provider: string;
}> {}
