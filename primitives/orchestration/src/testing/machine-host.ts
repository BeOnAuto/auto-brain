import type { JsonObject } from '@beonauto/workflow-engine';

import type { SettleRequest, SpecCall } from './run-terms.ts';

export type Command =
  | { readonly kind: 'timer'; readonly milliseconds: number; readonly summary: string }
  | { readonly kind: 'deadline'; readonly milliseconds: number }
  | { readonly kind: 'call'; readonly call: SpecCall }
  | { readonly kind: 'cancelled'; readonly summary: string }
  | { readonly kind: 'emitted'; readonly event: JsonObject }
  | { readonly kind: 'settle'; readonly request: SettleRequest };

export interface MachineHost {
  readonly commands: () => readonly Command[];
  readonly now: () => number;
  readonly cancelWorkflow: () => void;
  readonly at: (milliseconds: number, action: () => void) => void;
}

export interface WorkflowStart {
  readonly deliver: (event: unknown) => void;
}
