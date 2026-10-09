import type {
  CallLink,
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
  readonly type: string;
  readonly name: string;
  readonly input: Schema.Json;
  readonly runId: string;
  readonly lineage: Lineage;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy: CallLink;
}

export type EndedRunResult =
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

export type DefinitionRunResult = EndedRunResult | { readonly status: 'waiting' };

export type RunDefinition = (run: DefinitionRunRequest) => Effect.Effect<DefinitionRunResult>;
