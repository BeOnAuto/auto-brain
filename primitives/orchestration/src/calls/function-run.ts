import type { CallerIdentity, Issue, RejectionReason } from '@beonauto/operations';
import type { Effect, Schema } from 'effect';

export interface DefinitionRunRequest {
  readonly org: string;
  readonly brain: string;
  readonly caller: CallerIdentity;
  readonly primitive: string;
  readonly name: string;
  readonly input: Schema.Json;
  readonly executionId: string;
}

export type DefinitionRunResult =
  | { readonly status: 'succeeded'; readonly output: Schema.Json }
  | {
      readonly status: 'rejected';
      readonly reason: RejectionReason;
      readonly detail: string;
      readonly issues?: readonly Issue[];
    }
  | { readonly status: 'failed'; readonly detail: string };

export type RunDefinition = (execution: DefinitionRunRequest) => Effect.Effect<DefinitionRunResult>;
