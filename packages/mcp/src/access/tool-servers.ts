import { Result } from 'effect';

import { cutToFailureBound } from '../bounds/call-bounds.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { shownTool, type Showing } from '../listing/shown-tools.ts';
import type { ToolServer } from '../listing/tool-server.ts';
import { isAllowed } from '../names/tool-reference.ts';
import { isListedFor, type ServersScope } from '../settings/mcp-settings.ts';
import { connectedTo, type Listing } from './server-listing.ts';
import { offeredOn } from './tool-naming.ts';

export interface ServersListing extends Listing, Showing {
  readonly links: ReadonlyMap<string, ServerLink>;
}

async function toolServerOf(link: ServerLink, listing: ServersListing): Promise<ToolServer> {
  const { name, type } = link.settings;
  const everyTool = { server: name, tool: '*' };
  if (!isAllowed(everyTool, listing.allowed)) {
    return { name, type, tools: [] };
  }
  const connected = await connectedTo(link, listing);
  if (Result.isFailure(connected)) {
    const { detail, because } = connected.failure;
    return { name, type, unavailable: cutToFailureBound(detail), because };
  }
  const listed = connected.success;
  await listed.slot.release();
  const offered = offeredOn(listed, { references: [everyTool], allowed: listing.allowed });
  return { name, type, tools: offered.map(({ tool }) => shownTool(tool, name, listing)) };
}

function byName(first: ServerLink, second: ServerLink): number {
  return first.settings.name < second.settings.name ? -1 : 1;
}

export interface ServersAsked {
  readonly scope: ServersScope;
  readonly named: string | undefined;
}

export function toolServersOf({ scope, named }: ServersAsked, listing: ServersListing): Promise<readonly ToolServer[]> {
  const asked = [...listing.links.values()].filter(({ settings }) => isListedFor(settings, scope, named));
  return Promise.all(asked.toSorted(byName).map((link) => toolServerOf(link, listing)));
}
