import type { CallerIdentity, Settlement } from '@beonauto/operations';
import type { Json, JsonObject } from '@beonauto/workflow-engine';

export interface SpecCall {
  readonly org: string;
  readonly brain: string;
  readonly caller: CallerIdentity;
  readonly reference: string;
  readonly run: number;
  readonly primitive: string;
  readonly name: string;
  readonly input: Json;
}

export type SpecCallResult =
  | { readonly status: 'succeeded'; readonly output: Json }
  | { readonly status: 'rejected'; readonly reason: string; readonly detail: string }
  | { readonly status: 'failed'; readonly detail: string };

export type RunSettlement = Settlement;

export interface SettleRequest {
  readonly org: string;
  readonly brain: string;
  readonly spec: string;
  readonly executionId: string;
  readonly settlement: RunSettlement;
}

export interface WorkflowRun {
  readonly document: JsonObject;
  readonly input: Json;
  readonly execution: {
    readonly id: string;
    readonly org: string;
    readonly brain: string;
    readonly spec: { readonly name: string; readonly version: number };
  };
  readonly caller: CallerIdentity;
  readonly mostDuration: number;
  readonly longestNestedExecutionMs: number;
}

export const defaultMostDuration = 2_592_000_000;

export const defaultLongestNestedExecutionMs = 600_000;
