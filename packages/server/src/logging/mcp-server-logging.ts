import type { ServerMessage } from '@on.auto/mcp';
import { Effect } from 'effect';

function callerOf({ run_id, tool_test_id }: ServerMessage): Readonly<Record<string, string>> | undefined {
  if (run_id !== null) {
    return { run_id };
  }
  return tool_test_id === null ? undefined : { tool_test_id };
}

export function logUntestableServer(server: string): Effect.Effect<void> {
  return Effect.logInfo(
    `The MCP server ${server} marks none of its allowed tools read-only and its entry marks none testable, so test_tool_call can test none of its tools; name the tools that are safe to test under testable`,
  ).pipe(Effect.annotateLogs({ mcp_server: server }));
}

export function logServerMessage(report: ServerMessage): Effect.Effect<void> {
  const { server, message } = report;
  const caller = callerOf(report);
  return caller === undefined
    ? Effect.logInfo(`MCP server ${server} wrote: ${message}`).pipe(Effect.annotateLogs({ mcp_server: server }))
    : Effect.logWarning(`MCP server ${server} failed a call`).pipe(
        Effect.annotateLogs({ mcp_server: server, ...caller, server_message: message }),
      );
}
