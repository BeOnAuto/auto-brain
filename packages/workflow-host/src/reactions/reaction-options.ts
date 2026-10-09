import type { EmitEvent, StartingTrigger } from '@beonauto/definitions';
import type { StreamSignal } from '@beonauto/ledger';
import { Data, type Effect, type Schema } from 'effect';

import type { StartRejected } from './start-rejected.ts';

export interface ReactionStart {
  readonly org: string;
  readonly brain: string;
  readonly workflow: string;
  readonly version: number;
  readonly runId: string;
  readonly input: Schema.Json;
  readonly depth: number;
  readonly cause: string;
  readonly trigger: StartingTrigger;
}

export class StartRefused extends Data.TaggedError('start_refused')<{ readonly detail: string }> {}

export type StartReaction = (start: ReactionStart) => Effect.Effect<void, StartRefused | StartRejected>;

export interface ReactionOptions {
  readonly type: string;
  readonly start: StartReaction;
  readonly emit: EmitEvent;
  readonly appended?: StreamSignal;
}
