import { Result } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { takenSlot } from '../calls/server-slot.ts';
import { failureOf, type FailureKind, type ServerFailure } from '../connections/server-failures.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { McpServerFailed, type ServerFailedBecause } from './mcp-server-failed.ts';
import type { Listed } from './tool-naming.ts';

export interface Listing {
  readonly secrets: Secrets;
  readonly timing: Timing;
}

const failedBecause: Readonly<Record<FailureKind, ServerFailedBecause>> = {
  unreachable: 'unreachable',
  timed_out: 'unreachable',
  closed: 'unreachable',
  rate_limited: 'rate_limited',
  failing: 'failing',
  forgotten: 'failing',
  refused: 'failing',
  key_refused: 'key_refused',
};

function serverFailed(link: ServerLink, { kind, message }: ServerFailure, { scrub }: Secrets): McpServerFailed {
  return new McpServerFailed({
    because: failedBecause[kind],
    detail: `The MCP server ${link.settings.name} could not be used: ${scrub(message)}`,
  });
}

export async function connectedTo(
  link: ServerLink,
  { secrets, timing }: Listing,
): Promise<Result.Result<Listed, McpServerFailed>> {
  const taken = await takenSlot(link);
  if (Result.isFailure(taken)) {
    return Result.fail(serverFailed(link, taken.failure, secrets));
  }
  const slot = taken.success;
  return slot
    .connection()
    .listTools(timing.openMs)
    .then(
      (tools) => Result.succeed({ slot, tools }),
      async (error: unknown) => {
        await slot.release();
        return Result.fail(serverFailed(link, failureOf(error), secrets));
      },
    );
}

export async function released(listed: readonly Listed[]): Promise<void> {
  await Promise.all(listed.map(({ slot }) => slot.release()));
}

export async function listedOn(
  links: readonly ServerLink[],
  listing: Listing,
): Promise<Result.Result<readonly Listed[], McpServerFailed>> {
  const connected = await Promise.all(links.map((link) => connectedTo(link, listing)));
  const listed: Listed[] = [];
  const failures: McpServerFailed[] = [];
  for (const each of connected) {
    if (Result.isSuccess(each)) {
      listed.push(each.success);
    } else {
      failures.push(each.failure);
    }
  }
  const [failure] = failures;
  if (failure === undefined) {
    return Result.succeed(listed);
  }
  await released(listed);
  return Result.fail(failure);
}
