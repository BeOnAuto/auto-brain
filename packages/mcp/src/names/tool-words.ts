import type { CallFailedBecause } from '../calls/call-facts.ts';
import type { ToolReference } from './tool-reference.ts';

export function answeredInWords(isError: boolean): string {
  return isError ? 'answered with an error of its own' : 'answered';
}

export const failedInWords: Readonly<Record<CallFailedBecause, string>> = {
  arguments_refused: 'was refused by its server, which did not take its arguments',
  server_failure: 'failed at its server',
  timed_out: 'took too long, so it was given up',
  cancelled: 'was cancelled when the run ended',
};

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

export function toolInWords({ server, tool }: ToolReference): string {
  return toolsOfServer(server, [tool]);
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
