import {
  writtenOf,
  type NotOfferedBecause,
  type RunTools,
  type ServerFailedBecause,
  type ToolAccess,
  type ToolReference,
} from '@beonauto/mcp';
import { Unavailable } from '@beonauto/operations';
import type { ExecutionContext } from '@beonauto/specs';
import { Effect } from 'effect';

interface Refused<Because> {
  readonly because: Because;
  readonly detail: string;
}

const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

function noServerFor(references: readonly ToolReference[]): Unavailable {
  const named = conjunction.format(references.map((reference) => writtenOf(reference)));
  return new Unavailable({
    detail: `The reason function names ${named}, but no MCP server is configured on this server`,
    kind: 'tool_not_offered',
    because: 'mcp_server_not_configured',
  });
}

function opened(
  access: ToolAccess,
  references: readonly ToolReference[],
  { id, org, brain, journal }: ExecutionContext,
): Effect.Effect<RunTools, Unavailable> {
  return access.open({ id, org, brain, journal }, references).pipe(
    Effect.catchTags({
      tool_not_offered: ({ because, detail }: Refused<NotOfferedBecause>) =>
        Effect.fail(new Unavailable({ detail, kind: 'tool_not_offered', because })),
      mcp_server_failed: ({ because, detail }: Refused<ServerFailedBecause>) =>
        Effect.fail(new Unavailable({ detail, kind: 'mcp_server_failed', because })),
    }),
  );
}

export function withTools<A, E>(
  access: ToolAccess | undefined,
  references: readonly ToolReference[],
  execution: ExecutionContext,
  use: (tools?: RunTools) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Unavailable> {
  if (references.length === 0) {
    return use();
  }
  if (access === undefined) {
    return Effect.fail(noServerFor(references));
  }
  return opened(access, references, execution).pipe(
    Effect.flatMap((tools) => use(tools).pipe(Effect.ensuring(Effect.promise(() => tools.close())))),
  );
}
