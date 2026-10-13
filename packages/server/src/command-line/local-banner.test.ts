import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import { headerOf, readyNoticeOf, stoppedNotice, stoppingNotice } from './local-banner.ts';
import { logoHeight, logoWidth } from './logo.ts';

const ready = { url: 'http://localhost:5555', readyInMs: 640 };

describe('the header of the auto-runtime command', () => {
  it('names the runtime and its version in plain text where there are no colors', () => {
    expect(headerOf('0.7.0', 1)).toBe('\nAuto Runtime v0.7.0\nRuns the playbooks your agent builds\n\n');
  });

  it('draws the logo with the name and the version beside its middle where there are colors', () => {
    const lines = headerOf('0.7.0', 24).split('\n');
    const plain = lines.map((line) => stripVTControlCharacters(line));

    expect(lines).toHaveLength(logoHeight + 3);
    const titleLine = Math.floor(logoHeight / 2);

    expect(plain[titleLine]?.slice(2 + logoWidth)).toBe('  Auto Runtime v0.7.0');
    expect(plain[titleLine + 1]?.slice(2 + logoWidth)).toBe('  Runs the playbooks your agent builds');
  });
});

describe('the notice that the server is ready', () => {
  it('gives the addresses and how to connect an agent', () => {
    expect(readyNoticeOf(ready, 1).split('\n')).toEqual([
      '  ✔ Ready in 640 ms',
      '  ➜  Studio   https://studio.on.auto',
      '     Server   http://localhost:5555',
      '     MCP      http://localhost:5555/mcp',
      '     Docs     https://on.auto/docs/',
      '',
      '  Connect your agent',
      '    Claude Code   claude mcp add --transport http auto-runtime http://localhost:5555/mcp',
      '    Codex         codex mcp add auto-runtime --url http://localhost:5555/mcp',
      '',
      '  Press Ctrl+C to stop.',
      '',
    ]);
  });

  it('links the addresses where the terminal shows colors', () => {
    const notice = readyNoticeOf(ready, 24);

    expect(notice).toContain('\u001B]8;;http://localhost:5555/mcp\u001B\\http://localhost:5555/mcp\u001B]8;;\u001B\\');
    expect(stripVTControlCharacters(notice)).toBe(readyNoticeOf(ready, 1));
  });

  it('shows Studio by its address alone for the default server, and links to it with the server', () => {
    const notice = readyNoticeOf(ready, 24);

    expect(notice).toContain(
      '\u001B]8;;https://studio.on.auto/?server=http%3A%2F%2Flocalhost%3A5555\u001B\\https://studio.on.auto\u001B]8;;\u001B\\',
    );
  });

  it('shows the server in the Studio address when it is not the default one', () => {
    expect(readyNoticeOf({ ...ready, url: 'http://localhost:6000' }, 1)).toContain(
      '  ➜  Studio   https://studio.on.auto/?server=http://localhost:6000\n',
    );
  });

  it('sets the Studio link apart, in bold cyan, and dims the labels of the others', () => {
    const lines = readyNoticeOf(ready, 24).split('\n');
    const studio = String(lines.find((line) => line.includes('Studio')));
    const server = String(lines.find((line) => line.includes('Server')));

    expect(studio).toContain('\u001B[36m\u001B[1m\u001B]8;;https://studio.on.auto/');
    expect(server).toContain('\u001B[2mServer  \u001B[22m');
    expect(server).not.toContain('\u001B[1m');
  });
});

describe('the notices of a stop', () => {
  it('say that the server is stopping and then that it stopped', () => {
    expect(stoppingNotice(1)).toBe('\n  Stopping…\n');
    expect(stoppedNotice(1)).toBe('  ✔ Stopped\n');
    expect(stripVTControlCharacters(stoppedNotice(24))).toBe(stoppedNotice(1));
  });
});
