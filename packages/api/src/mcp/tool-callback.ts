import { settle, type DispatcherServices, type Outcome } from '@beonauto/operations';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { Effect, Schema } from 'effect';

import type { RunCall } from '../operations/operation-routes.ts';
import type { ReportThrown } from '../problem/error-boundary.ts';
import type { OrgCall } from './caller-hand-off.ts';
import { withDroppedArgument } from './dropped-arguments.ts';
import { problemResultOf, toolResultOf } from './tool-result.ts';

export type Dispatch = (input: Readonly<Record<string, unknown>>) => Effect.Effect<Outcome, never, DispatcherServices>;

export interface CallServing {
  readonly runCall: RunCall;
  readonly reportThrown: ReportThrown;
}

interface ToolContext {
  readonly mcpReq: { readonly id: string | number; readonly signal: AbortSignal };
}

const argumentsOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

export function callbackFor(
  { runCall, reportThrown }: CallServing,
  { requestId, dropped }: OrgCall,
  dispatch: Dispatch,
): (input: unknown, context: ToolContext) => Promise<CallToolResult> {
  return async (input, { mcpReq: { id, signal } }) => {
    try {
      const restored = withDroppedArgument(
        argumentsOf(input),
        dropped.find((argument) => argument.id === id),
      );
      const call = settle(dispatch(restored), signal).pipe(Effect.annotateLogs({ requestId }));
      return toolResultOf(await runCall(call), signal.aborted);
    } catch (thrown) {
      return problemResultOf(reportThrown(thrown, requestId));
    }
  };
}
