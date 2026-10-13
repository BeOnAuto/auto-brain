import { studioOrigin } from '@on.auto/api';

import { linkerFor, painterFor, type ColorDepth } from '../logging/terminal.ts';
import { logoHeight, logoLines, type PaintingDepth } from './logo.ts';

export interface Ready {
  readonly url: string;
  readonly readyInMs: number;
  readonly providers: readonly string[];
  readonly ledger: string;
}

const tagline = 'Runs the playbooks your agent builds';

function plainHeader(version: string): string {
  return `\nAuto Runtime v${version}\n${tagline}\n\n`;
}

function paintedHeader(version: string, depth: PaintingDepth): string {
  const paint = painterFor(depth);
  const titleRow = Math.floor(logoHeight / 2) - 1;
  const besideLogo = new Map([
    [titleRow, `${paint('bold', 'Auto Runtime')} ${paint('dim', `v${version}`)}`],
    [titleRow + 1, paint('dim', tagline)],
  ]);
  const lines = logoLines(depth).map((line, row) => {
    const beside = besideLogo.get(row);
    return beside === undefined ? `  ${line}` : `  ${line.trimEnd()}   ${beside}`;
  });
  return `\n${lines.join('\n')}\n\n`;
}

export function headerOf(version: string, depth: ColorDepth): string {
  return depth === 1 ? plainHeader(version) : paintedHeader(version, depth);
}

function modelsLine(providers: readonly string[], depth: ColorDepth): string {
  const paint = painterFor(depth);
  return providers.length === 0
    ? paint('yellow', 'none yet; put a key such as ANTHROPIC_API_KEY in .env in this directory')
    : providers.join(', ');
}

export function readyNoticeOf({ url, readyInMs, providers, ledger }: Ready, depth: ColorDepth): string {
  const paint = painterFor(depth);
  const link = linkerFor(depth);
  const mcp = `${url}/mcp`;
  const entry = (label: string, value: string): string =>
    `  ${paint('cyan', '➜')}  ${paint('bold', label.padEnd(8))} ${value}`;
  const agent = (label: string, command: string): string => `    ${label.padEnd(13)} ${paint('dim', command)}`;
  return [
    '',
    `  ${paint('green', '✔')} Ready in ${readyInMs} ms`,
    '',
    entry('Server', link(url)),
    entry('MCP', link(mcp)),
    entry('Studio', link(`${studioOrigin}/?server=${encodeURIComponent(url)}`)),
    entry('Models', modelsLine(providers, depth)),
    entry('Ledger', ledger),
    '',
    `  ${paint('bold', 'Connect your agent')}`,
    agent('Claude Code', `claude mcp add --transport http auto-runtime ${mcp}`),
    agent('Codex', `codex mcp add auto-runtime --url ${mcp}`),
    '',
    `  ${paint('dim', 'Press Ctrl+C to stop.')}`,
    '',
  ].join('\n');
}

export function stoppingNotice(depth: ColorDepth): string {
  return `\n  ${painterFor(depth)('dim', 'Stopping…')}\n`;
}

export function stoppedNotice(depth: ColorDepth): string {
  return `  ${painterFor(depth)('green', '✔')} Stopped\n`;
}
