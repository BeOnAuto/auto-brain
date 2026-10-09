import { servesBrain } from '@beonauto/config';
import { capitalized, type BrainAddress } from '@beonauto/operations';
import { Result } from 'effect';

import type { ListedTool } from '../bounds/result-text.ts';
import type { OfferedOnServer } from '../calls/run-parts.ts';
import type { ServerSlot } from '../calls/server-slot.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { allowsTool, isAllowed, namesEveryTool, writtenOf, type ToolReference } from '../names/tool-reference.ts';
import { ToolNotOffered } from './tool-not-offered.ts';

export interface Naming {
  readonly references: readonly ToolReference[];
  readonly links: ReadonlyMap<string, ServerLink>;
}

export interface Listed {
  readonly slot: ServerSlot;
  readonly tools: readonly ListedTool[];
}

interface NamedLink {
  readonly reference: ToolReference;
  readonly link: ServerLink | undefined;
}

interface ServingLink {
  readonly reference: ToolReference;
  readonly link: ServerLink;
}

const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const disjunction = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' });

function notConfigured(named: readonly ToolReference[]): ToolNotOffered {
  const servers = disjunction.format(new Set(named.map(({ server }) => server)));
  return new ToolNotOffered({
    because: 'mcp_server_not_configured',
    detail: `No MCP server named ${servers} is configured for this brain`,
  });
}

function notAllowed(named: readonly ToolReference[]): ToolNotOffered {
  const tools = conjunction.format(named.map((reference) => writtenOf(reference)));
  return new ToolNotOffered({
    because: 'tool_not_allowed',
    detail: `The operator of this server does not allow ${tools}`,
  });
}

function toolsNamed(references: readonly ToolReference[]): string {
  const tools = conjunction.format(references.map(({ tool }) => tool));
  return references.length === 1 ? `the tool ${tools}` : `the tools ${tools}`;
}

export function notListed(missing: readonly ToolReference[]): ToolNotOffered {
  const byServer = Map.groupBy(missing, ({ server }) => server);
  const unlisted = [...byServer].map(
    ([server, references]: readonly [string, readonly ToolReference[]]) =>
      `the MCP server ${server} does not list ${toolsNamed(references)}`,
  );
  return new ToolNotOffered({ because: 'tool_not_listed', detail: capitalized(conjunction.format(unlisted)) });
}

function isServing(named: NamedLink, address: BrainAddress): named is ServingLink {
  return named.link !== undefined && servesBrain(named.link.settings, address);
}

export function namedLinks(
  address: BrainAddress,
  { references, links }: Naming,
): Result.Result<readonly ServerLink[], ToolNotOffered> {
  const named = references.map((reference): NamedLink => ({ reference, link: links.get(reference.server) }));
  const unconfigured = named.filter((each) => !isServing(each, address));
  if (unconfigured.length > 0) {
    return Result.fail(notConfigured(unconfigured.map(({ reference }) => reference)));
  }
  const serving = named.filter((each) => isServing(each, address));
  const disallowed = serving.filter(({ reference, link }) => !isAllowed(reference, link.settings.allowed));
  if (disallowed.length > 0) {
    return Result.fail(notAllowed(disallowed.map(({ reference }) => reference)));
  }
  return Result.succeed([...new Set(serving.map(({ link }) => link))]);
}

type Offering = Pick<Naming, 'references'>;

function namedOn({ slot }: Listed, naming: Offering): readonly ToolReference[] {
  return naming.references.filter((reference) => reference.server === slot.settings.name);
}

export function offeredOn(listed: Listed, naming: Offering): readonly OfferedOnServer[] {
  const named = namedOn(listed, naming);
  const { slot } = listed;
  const server = slot.settings.name;
  return listed.tools
    .filter((tool) =>
      named.some((reference) =>
        namesEveryTool(reference) ? allowsTool(slot.settings.allowed, tool.name) : reference.tool === tool.name,
      ),
    )
    .map((tool) => ({ slot, reference: { server, tool: tool.name }, tool }));
}

export function unlistedOn(listed: Listed, naming: Offering): readonly ToolReference[] {
  return namedOn(listed, naming).filter(
    (reference) => !namesEveryTool(reference) && !listed.tools.some(({ name }) => name === reference.tool),
  );
}
