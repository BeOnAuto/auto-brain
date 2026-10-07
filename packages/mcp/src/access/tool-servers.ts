import type { BrainAddress } from '@beonauto/operations';
import { Predicate, Result, Schema } from 'effect';

import { cutToDescriptionBound } from '../bounds/call-bounds.ts';
import type { ListedTool } from '../bounds/result-text.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { ServerTool, ToolServer } from '../listing/tool-server.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { isListedFor } from '../settings/mcp-settings.ts';
import { connectedTo, type Listing } from './server-listing.ts';
import { offeredOn } from './tool-naming.ts';

export interface ServersListing extends Listing {
  readonly links: ReadonlyMap<string, ServerLink>;
  readonly allowed: readonly ToolReference[] | null;
}

type Scrub = (text: string) => string;

const decodeJsonObject = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject));

function scrubbing(scrub: Scrub): (key: string, value: unknown) => unknown {
  return (_key, value) => {
    if (typeof value === 'string') {
      return scrub(value);
    }
    return Predicate.isObject(value)
      ? Object.fromEntries(Object.entries(value).map(([key, item]: readonly [string, unknown]) => [scrub(key), item]))
      : value;
  };
}

function shownTool({ name, description = '', inputSchema }: ListedTool, scrub: Scrub): ServerTool {
  return {
    name: scrub(name),
    description: cutToDescriptionBound(scrub(description)),
    input_schema: decodeJsonObject(JSON.stringify(inputSchema, scrubbing(scrub))),
  };
}

async function toolServerOf(link: ServerLink, listing: ServersListing): Promise<ToolServer> {
  const { name, type } = link.settings;
  const connected = await connectedTo(link, listing);
  if (Result.isFailure(connected)) {
    return { name, type, unavailable: cutToDescriptionBound(connected.failure.detail) };
  }
  const listed = connected.success;
  await listed.slot.release();
  const offered = offeredOn(listed, { references: [{ server: name, tool: '*' }], allowed: listing.allowed });
  return { name, type, tools: offered.map(({ tool }) => shownTool(tool, listing.secrets.scrub)) };
}

function byName(first: ServerLink, second: ServerLink): number {
  return first.settings.name < second.settings.name ? -1 : 1;
}

export interface ServersAsked {
  readonly address: BrainAddress;
  readonly named: string | undefined;
}

export function toolServersOf(
  { address, named }: ServersAsked,
  listing: ServersListing,
): Promise<readonly ToolServer[]> {
  const asked = [...listing.links.values()].filter(({ settings }) => isListedFor(settings, address, named));
  return Promise.all(asked.toSorted(byName).map((link) => toolServerOf(link, listing)));
}
