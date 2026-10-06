import type {
  CallerIdentity,
  Issue,
  Lineage,
  RejectionKind,
  RejectionReason,
  UnavailableBecause,
} from '@beonauto/operations';
import type { Effect, Schema } from 'effect';

export interface DefinitionRunRequest {
  readonly org: string;
  readonly brain: string;
  readonly caller: CallerIdentity;
  readonly primitive: string;
  readonly name: string;
  readonly input: Schema.Json;
  readonly executionId: string;
  readonly lineage: Lineage;
  readonly depth: number;
}

export type DefinitionRunResult =
  | { readonly status: 'succeeded'; readonly output: Schema.Json }
  | {
      readonly status: 'rejected';
      readonly reason: RejectionReason;
      readonly detail: string;
      readonly issues?: readonly Issue[];
      readonly kind?: RejectionKind;
      readonly because?: UnavailableBecause;
    }
  | { readonly status: 'failed'; readonly detail: string };

export type RunDefinition = (execution: DefinitionRunRequest) => Effect.Effect<DefinitionRunResult>;
