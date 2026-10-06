import { Result } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { serverSlot } from '../calls/server-slot.ts';
import { failureOf, type FailureKind } from '../connections/server-failures.ts';
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
};

async function connectedTo(
  link: ServerLink,
  { secrets, timing }: Listing,
): Promise<Result.Result<Listed, McpServerFailed>> {
  try {
    const connection = await link.take();
    const slot = serverSlot(link, connection);
    const tools = await connection.listTools(timing.openMs).catch(async (error: unknown) => {
      await slot.release();
      throw error;
    });
    return Result.succeed({ slot, tools });
  } catch (error) {
    const { kind, message } = failureOf(error);
    return Result.fail(
      new McpServerFailed({
        because: failedBecause[kind],
        detail: `The MCP server ${link.settings.name} could not be used: ${secrets.scrub(message)}`,
      }),
    );
  }
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
