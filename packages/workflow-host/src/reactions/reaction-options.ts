import type { AppendSignal } from '@beonauto/ledger';
import type { EmitEvent } from '@beonauto/specs';
import type { LiteralFilter } from '@beonauto/workflow-engine';
import { Data, type Effect, type Schema } from 'effect';

import type { StartRejected } from './start-rejected.ts';

export type Trigger =
  | { readonly kind: 'events'; readonly filters: readonly LiteralFilter[] }
  | { readonly kind: 'cron'; readonly expression: string }
  | { readonly kind: 'every'; readonly milliseconds: number };

export interface ReactionStart {
  readonly org: string;
  readonly brain: string;
  readonly workflow: string;
  readonly version: number;
  readonly executionId: string;
  readonly input: Schema.Json;
  readonly depth: number;
  readonly cause: string | null;
}

export class StartRefused extends Data.TaggedError('start_refused')<{ readonly detail: string }> {}

export type StartReaction = (start: ReactionStart) => Effect.Effect<void, StartRefused | StartRejected>;

export interface ReactionOptions {
  readonly primitive: string;
  readonly triggerOf: (source: string) => Trigger | undefined;
  readonly start: StartReaction;
  readonly emit: EmitEvent;
  readonly appended?: AppendSignal;
}
