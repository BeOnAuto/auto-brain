import type { ToolReference } from './tool-reference.ts';

const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const wordBoundary = /(?<lower>[a-z0-9])(?<upper>[A-Z])/gu;

const separators = /[^A-Za-z0-9]+/gu;

export function inWords(name: string): string {
  return name.replaceAll(wordBoundary, '$<lower> $<upper>').replaceAll(separators, ' ').trim().toLowerCase();
}

function toolsOfServer(server: string, tools: readonly string[]): string {
  const distinct = [...new Set(tools)];
  const named = conjunction.format(distinct.map((tool) => inWords(tool)));
  return `the ${named} ${distinct.length === 1 ? 'tool' : 'tools'} of ${inWords(server)}`;
}

export function toolsInWords(tools: readonly ToolReference[]): string {
  const byServer = Map.groupBy(tools, ({ server }) => server);
  const parts = [...byServer].map(([server, used]: readonly [string, readonly ToolReference[]]) =>
    toolsOfServer(
      server,
      used.map(({ tool }) => tool),
    ),
  );
  return parts.length === 0 ? 'no tool' : conjunction.format(parts);
}
