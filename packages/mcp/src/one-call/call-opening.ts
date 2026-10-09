import { Result } from 'effect';

import { listedThrough, serverFailed, type Listing } from '../access/server-listing.ts';
import { notListed } from '../access/tool-naming.ts';
import type { ListedTool } from '../bounds/tool-results.ts';
import type { ServerSlot } from '../calls/server-slot.ts';
import { failureOf, type ServerFailure } from '../connections/server-failures.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { failedToOpenOnce, notOfferedOnce, type UnopenedOnce } from './called-once.ts';
import { boundedSlot, takenWithin } from './connection-bound.ts';

export interface Opened {
  readonly slot: ServerSlot;
  readonly tool: ListedTool;
}

async function restartedIfExited(slot: ServerSlot): Promise<ServerFailure | undefined> {
  const restart = await slot.restartIfExited().catch((error: unknown) => failureOf(error));
  return typeof restart === 'string' ? undefined : restart;
}

export async function openedFor(
  reference: ToolReference,
  link: ServerLink,
  listing: Listing,
): Promise<Opened | UnopenedOnce> {
  const { openMs } = listing.timing;
  const taken = await takenWithin(link, openMs);
  if ('late' in taken) {
    const message = `The MCP server did not open a connection within ${openMs} ms`;
    return failedToOpenOnce(serverFailed(link, { kind: 'timed_out', message }, listing.secrets));
  }
  if ('failure' in taken) {
    return failedToOpenOnce(serverFailed(link, taken.failure, listing.secrets));
  }
  const bounded = boundedSlot(taken.slot, openMs);
  const exited = await restartedIfExited(bounded);
  if (exited !== undefined) {
    await bounded.release();
    return failedToOpenOnce(serverFailed(link, exited, listing.secrets));
  }
  const listed = await listedThrough(bounded, listing);
  if (Result.isFailure(listed)) {
    return failedToOpenOnce(listed.failure);
  }
  const { slot, tools } = listed.success;
  const tool = tools.find(({ name }) => name === reference.tool);
  if (tool === undefined) {
    await slot.release();
    return notOfferedOnce(notListed([reference]));
  }
  return { slot, tool };
}
