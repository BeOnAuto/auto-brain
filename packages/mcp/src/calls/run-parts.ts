import type { Effect } from 'effect';

import type { CallsEndedBecause } from '../access/mcp-server-failed.ts';
import type { RunContext, ServerMessage } from '../access/run-context.ts';
import type { CallTally, Timing } from '../bounds/call-bounds.ts';
import type { ListedTool } from '../bounds/result-text.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { ServerSlot } from './server-slot.ts';

export interface OfferedOnServer {
  readonly slot: ServerSlot;
  readonly reference: ToolReference;
  readonly tool: ListedTool;
}

export interface NamedOffer extends OfferedOnServer {
  readonly name: string;
}

export interface ToolCallRequest {
  readonly callId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface CallSignals {
  readonly signal: Readonly<AbortSignal>;
  readonly cancelled: Readonly<AbortSignal>;
}

export interface RunToolsParts {
  readonly execution: RunContext;
  readonly slots: readonly ServerSlot[];
  readonly offered: readonly OfferedOnServer[];
  readonly secrets: Secrets;
  readonly timing: Timing;
  readonly report: (message: ServerMessage) => void;
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

export interface RunState {
  readonly tally: () => CallTally;
  readonly tallied: (tally: CallTally) => void;
  readonly used: (reference: ToolReference) => void;
  readonly ended: (because: CallsEndedBecause) => void;
}
