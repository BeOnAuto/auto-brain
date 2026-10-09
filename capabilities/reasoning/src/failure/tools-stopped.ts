import { Data } from 'effect';

import type { TokenUsage } from '../model/model-result.ts';

export type ToolsStoppedBecause = 'server_failed' | 'run_bound' | 'no_answer';

export class ToolsStopped extends Data.TaggedError('tools_stopped')<{
  readonly detail: string;
  readonly provider: string;
  readonly because: ToolsStoppedBecause;
  readonly usage?: TokenUsage;
}> {}
