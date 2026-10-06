import { Data, type Schema } from 'effect';

import type { Issue } from './issue.ts';

export class InvalidInput extends Data.TaggedError('invalid_input')<{
  readonly detail: string;
  readonly issues: readonly Issue[];
  readonly record?: Schema.JsonObject;
}> {}
