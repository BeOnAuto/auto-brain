import { Data } from 'effect';

import type { FailureIssue } from './failure-issue.ts';

export class SpecInvalid extends Data.TaggedError('spec_invalid')<{
  readonly detail: string;
  readonly provider: string | null;
  readonly status: number | null;
  readonly provider_message: string | null;
  readonly issues: readonly FailureIssue[];
}> {}
