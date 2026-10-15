import { studioOrigin, type AccessMode } from '@on.auto/identity';

import { linkerFor, painterFor, type ColorDepth } from '../logging/terminal.ts';
import { logoHeight, logoLines, type PaintingDepth } from './logo.ts';

export interface Ready {
  readonly url: string;
  readonly readyInMs: number;
  readonly mode: AccessMode;
  readonly identityService: string | undefined;
}

const tagline = 'Runs the playbooks your agent builds';

const documentation = 'https://on.auto/docs/';

const studioDefaultServer = 'http://localhost:5555';

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
    return beside === undefined ? `  ${line}` : `  ${line}  ${beside}`;
  });
  return `\n${lines.join('\n')}\n\n`;
}

export function headerOf(version: string, depth: ColorDepth): string {
  return depth === 1 ? plainHeader(version) : paintedHeader(version, depth);
}

function localModeNotice(url: string, depth: ColorDepth): readonly string[] {
  const paint = painterFor(depth);
  return [
    '',
    `  ${paint('dim', 'Local mode: anyone on this computer acts as you, with no sign-in.')}`,
    `  ${paint('dim', `Set PUBLIC_URL=${url} to sign people in.`)}`,
  ];
}

export function readyNoticeOf({ url, readyInMs, mode, identityService }: Ready, depth: ColorDepth): string {
  const paint = painterFor(depth);
  const link = linkerFor(depth);
  const mcp = `${url}/mcp`;
  const studio = `${studioOrigin}/?server=${encodeURIComponent(url)}`;
  const studioShown = url === studioDefaultServer ? studioOrigin : `${studioOrigin}/?server=${url}`;
  const entry = (label: string, value: string): string => `     ${paint('dim', label.padEnd(8))} ${link(value, value)}`;
  const agent = (label: string, command: string): string => `    ${label.padEnd(13)} ${paint('dim', command)}`;
  const signIn = identityService === undefined ? [] : [entry('Sign-in', identityService)];
  return [
    `  ${paint('green', '✔')} Ready in ${readyInMs} ms`,
    `  ${paint('cyan', '➜')}  ${paint('bold', 'Studio'.padEnd(8))} ${paint(['cyan', 'bold'], link(studio, studioShown))}`,
    entry('Server', url),
    entry('MCP', mcp),
    ...signIn,
    entry('Docs', documentation),
    ...(mode === 'local' ? localModeNotice(url, depth) : []),
    '',
    `  ${paint('dim', 'Connect your agent')}`,
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

const spinnerFrames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

export function startingLine(frame: number, depth: ColorDepth): string {
  return `\r  ${painterFor(depth)('cyan', spinnerFrames.charAt(frame % spinnerFrames.length))} Starting…`;
}

export const clearedLine = '\r\u001B[2K';
