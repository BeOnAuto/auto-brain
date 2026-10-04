import type { CallerIdentity, Settlement } from '@beonauto/operations';
import type { Json } from '@beonauto/workflow-engine/dsl/json';

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

export interface HistorySize {
  readonly bytes: number;
  readonly events: number;
}

interface Cancellable<T> {
  readonly result: Promise<T>;
  readonly cancel: () => void;
}

export interface WorkflowHost {
  readonly now: () => number;
  readonly random: () => number;
  readonly historySize: () => HistorySize;
  readonly sleep: (milliseconds: number, summary: string) => Promise<void>;
  readonly deadline: (milliseconds: number) => Promise<void>;
  readonly waitUntil: (satisfied: () => boolean) => Promise<void>;
  readonly watch: (satisfied: () => boolean) => Promise<void>;
  readonly executeSpec: (call: SpecCall, longestMs: number) => Promise<SpecCallResult>;
  readonly settle: (request: SettleRequest) => Promise<void>;
  readonly cancellable: <T>(work: () => Promise<T>) => Cancellable<T>;
  readonly isCancellation: (error: unknown) => boolean;
}
