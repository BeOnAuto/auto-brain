import { Result } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { ListedTool } from '../bounds/tool-results.ts';
import { takenSlot, type ServerSlot } from '../calls/server-slot.ts';
import { failureOf, type FailureKind, type ServerFailure } from '../connections/server-failures.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { McpServerSettings } from '../settings/mcp-settings.ts';
import { McpServerFailed, type ServerFailedBecause } from './mcp-server-failed.ts';
import type { Listed } from './tool-naming.ts';

export interface Listing {
  readonly secrets: Secrets;
  readonly timing: Timing;
  readonly toolsListed: (server: McpServerSettings, tools: readonly ListedTool[]) => void;
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

export function serverFailed(
  { settings }: Pick<ServerLink, 'settings'>,
  { kind, message }: ServerFailure,
  { scrub }: Secrets,
): McpServerFailed {
  return new McpServerFailed({
    because: failedBecause[kind],
    detail: `The MCP server ${settings.name} could not be used: ${scrub(message)}`,
  });
}

export function listedThrough(
  slot: ServerSlot,
  { secrets, timing, toolsListed }: Listing,
): Promise<Result.Result<Listed, McpServerFailed>> {
  return slot
    .connection()
    .listTools(timing.openMs)
    .then(
      (tools) => {
        toolsListed(slot.settings, tools);
        return Result.succeed({ slot, tools });
      },
      async (error: unknown) => {
        await slot.release();
        return Result.fail(serverFailed(slot, failureOf(error), secrets));
      },
    );
}

export async function connectedTo(link: ServerLink, listing: Listing): Promise<Result.Result<Listed, McpServerFailed>> {
  const taken = await takenSlot(link);
  return Result.isFailure(taken)
    ? Result.fail(serverFailed(link, taken.failure, listing.secrets))
    : listedThrough(taken.success, listing);
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
