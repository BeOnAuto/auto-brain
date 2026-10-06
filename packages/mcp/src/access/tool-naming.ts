import { Result } from 'effect';

import type { ListedTool } from '../bounds/result-text.ts';
import type { OfferedOnServer } from '../calls/run-parts.ts';
import type { ServerSlot } from '../calls/server-slot.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { namesEveryTool, writtenOf, type ToolReference } from '../names/tool-reference.ts';
import { servesBrain } from '../settings/mcp-settings.ts';
import type { RunContext } from './run-context.ts';
import { ToolNotOffered, type NotOfferedBecause } from './tool-not-offered.ts';

export interface Naming {
  readonly execution: RunContext;
  readonly references: readonly ToolReference[];
  readonly links: ReadonlyMap<string, ServerLink>;
  readonly allowed: readonly ToolReference[] | null;
}

export interface Listed {
  readonly slot: ServerSlot;
  readonly tools: readonly ListedTool[];
}

interface NamedLink {
  readonly reference: ToolReference;
  readonly link: ServerLink | undefined;
}

const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

function listedOf(references: readonly ToolReference[]): string {
  return conjunction.format(references.map((reference) => writtenOf(reference)));
}

function isAllowed(reference: ToolReference, allowed: readonly ToolReference[] | null): boolean {
  return (
    allowed === null ||
    allowed.some(
      (entry) =>
        entry.server === reference.server &&
        (namesEveryTool(entry) || namesEveryTool(reference) || entry.tool === reference.tool),
    )
  );
}

export function notOffered(because: NotOfferedBecause, named: readonly ToolReference[], why: string): ToolNotOffered {
  return new ToolNotOffered({
    because,
    detail: `The reasoning function names ${listedOf(named)}, ${why}`,
  });
}

export function namedLinks({
  execution,
  references,
  links,
  allowed,
}: Naming): Result.Result<readonly ServerLink[], ToolNotOffered> {
  const configured = references.map((reference): NamedLink => ({ reference, link: links.get(reference.server) }));
  const unconfigured = configured.filter(({ link }) => link === undefined || !servesBrain(link.settings, execution));
  if (unconfigured.length > 0) {
    return Result.fail(
      notOffered(
        'mcp_server_not_configured',
        unconfigured.map(({ reference }) => reference),
        'but no MCP server of that name is configured for this brain',
      ),
    );
  }
  const disallowed = references.filter((reference) => !isAllowed(reference, allowed));
  if (disallowed.length > 0) {
    return Result.fail(notOffered('tool_not_allowed', disallowed, 'which the operator of this server does not allow'));
  }
  return Result.succeed([...new Set(configured.map(({ link }) => link))].filter((link) => link !== undefined));
}

function namedOn({ slot }: Listed, naming: Naming): readonly ToolReference[] {
  return naming.references.filter((reference) => reference.server === slot.settings.name);
}

export function offeredOn(listed: Listed, naming: Naming): readonly OfferedOnServer[] {
  const named = namedOn(listed, naming);
  const { slot } = listed;
  const server = slot.settings.name;
  return listed.tools
    .filter((tool) =>
      named.some((reference) =>
        namesEveryTool(reference)
          ? isAllowed({ server, tool: tool.name }, naming.allowed)
          : reference.tool === tool.name,
      ),
    )
    .map((tool) => ({ slot, reference: { server, tool: tool.name }, tool }));
}

export function unlistedOn(listed: Listed, naming: Naming): readonly ToolReference[] {
  return namedOn(listed, naming).filter(
    (reference) => !namesEveryTool(reference) && !listed.tools.some(({ name }) => name === reference.tool),
  );
}
