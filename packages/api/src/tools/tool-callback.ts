import { ServedAsTool, settle, type DispatcherServices, type Outcome } from '@beonauto/operations';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { Effect, Schema } from 'effect';

import type { OrgCall } from '../hand-off/caller-hand-off.ts';
import { withDroppedArgument } from '../hand-off/dropped-arguments.ts';
import type { RunCall } from '../operations/operation-routes.ts';
import type { ReportThrown } from '../problem/error-boundary.ts';
import { toolResultOf, type ToolWords } from './tool-result.ts';

export type Arguments = Readonly<Record<string, unknown>>;

export type Dispatch = (input: Arguments) => Effect.Effect<Outcome, never, DispatcherServices>;

export interface CallServing {
  readonly runCall: RunCall;
  readonly reportThrown: ReportThrown;
}

export interface CalledTool extends ToolWords {
  readonly dispatch: Dispatch;
  readonly operationInputOf: (input: Arguments) => Arguments;
}

interface ToolContext {
  readonly mcpReq: { readonly id: string | number; readonly signal: AbortSignal };
}

const argumentsOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

export function callbackFor(
  { runCall, reportThrown }: CallServing,
  { requestId, dropped }: OrgCall,
  { dispatch, operationInputOf, ...words }: CalledTool,
): (input: unknown, context: ToolContext) => Promise<CallToolResult> {
  return async (input, { mcpReq: { id, signal } }) => {
    let operationInput: unknown = input;
    try {
      const restored = withDroppedArgument(
        argumentsOf(input),
        dropped.find((argument) => argument.id === id),
      );
      operationInput = operationInputOf(restored);
      const call = settle(dispatch(restored), signal).pipe(
        Effect.provideService(ServedAsTool, true),
        Effect.annotateLogs({ requestId }),
      );
      return toolResultOf(await runCall(call), signal.aborted, words, operationInput);
    } catch (thrown) {
      return toolResultOf(reportThrown(thrown, requestId), false, words, operationInput);
    }
  };
}
