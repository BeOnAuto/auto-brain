import { Result } from 'effect';

import type { ServerLink } from '../connections/server-links.ts';
import { offeredOn } from '../names/tool-naming.ts';
import { serverFieldsOf, unavailableServer } from './server-fields.ts';
import { connectedTo, type Listing } from './server-listing.ts';
import { shownTool, type Showing } from './shown-tools.ts';
import type { ToolServer } from './tool-server.ts';

export type ServersListing = Listing & Showing;

export async function listedServer(link: ServerLink, listing: ServersListing): Promise<ToolServer> {
  const connected = await connectedTo(link, listing);
  if (Result.isFailure(connected)) {
    return unavailableServer(link.settings, connected.failure);
  }
  const listed = connected.success;
  await listed.slot.release();
  const offered = offeredOn(listed, { references: [{ server: link.settings.name, tool: '*' }] });
  return { ...serverFieldsOf(link.settings), tools: offered.map(({ tool }) => shownTool(tool, listing)) };
}
