import type { LeftOutOperation, ServerMessage } from '@on.auto/tool-servers';
import { Effect } from 'effect';

function callerOf({ run_id, tool_test_id }: ServerMessage): Readonly<Record<string, string>> | undefined {
  if (run_id !== null) {
    return { run_id };
  }
  return tool_test_id === null ? undefined : { tool_test_id };
}

export function logUntestableServer(server: string): Effect.Effect<void> {
  return Effect.logInfo(
    `The tool server ${server} marks none of its allowed tools read-only and its entry marks none testable, so test_tool_call can test none of its tools; name the tools that are safe to test under testable`,
  ).pipe(Effect.annotateLogs({ tool_server: server }));
}

export function logServerMessage(report: ServerMessage): Effect.Effect<void> {
  const { server, message } = report;
  const caller = callerOf(report);
  return caller === undefined
    ? Effect.logInfo(`Tool server ${server} wrote: ${message}`).pipe(Effect.annotateLogs({ tool_server: server }))
    : Effect.logWarning(`Tool server ${server} failed a call`).pipe(
        Effect.annotateLogs({ tool_server: server, ...caller, server_message: message }),
      );
}

export function logLeftOutOperation(server: string, { operation, because }: LeftOutOperation): Effect.Effect<void> {
  return Effect.logWarning(
    `The tool server ${server} offers no tool for the operation ${operation} of its document: ${because}`,
  ).pipe(Effect.annotateLogs({ tool_server: server }));
}
