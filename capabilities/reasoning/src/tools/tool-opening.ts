import type { RunContext } from '@beonauto/definitions';
import type { NotOfferedBecause, RunTools, ServerFailedBecause, ToolAccess } from '@beonauto/mcp';
import { runIdKey, type ToolReference } from '@beonauto/mcp/policy';
import { Unavailable } from '@beonauto/operations';
import { Effect } from 'effect';

interface Refused<Because> {
  readonly because: Because;
  readonly detail: string;
}

function opened(
  access: ToolAccess,
  references: readonly ToolReference[],
  { id, org, brain, journal }: RunContext,
): Effect.Effect<RunTools, Unavailable> {
  return access.open({ id, org, brain, journal, meta: { [runIdKey]: id } }, references).pipe(
    Effect.catchTags({
      tool_not_offered: ({ because, detail }: Refused<NotOfferedBecause>) =>
        Effect.fail(new Unavailable({ detail, kind: 'tool_not_offered', because })),
      mcp_server_failed: ({ because, detail }: Refused<ServerFailedBecause>) =>
        Effect.fail(new Unavailable({ detail, kind: 'mcp_server_failed', because })),
    }),
  );
}

export function withTools<A, E>(
  access: ToolAccess,
  references: readonly ToolReference[],
  run: RunContext,
  use: (tools?: RunTools) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Unavailable> {
  if (references.length === 0) {
    return use();
  }
  return opened(access, references, run).pipe(
    Effect.flatMap((tools) => use(tools).pipe(Effect.ensuring(Effect.promise(() => tools.close())))),
  );
}
