import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import { headerOf, readyNoticeOf, stoppedNotice, stoppingNotice } from './local-banner.ts';
import { logoHeight } from './logo.ts';

const ready = {
  url: 'http://localhost:5555',
  readyInMs: 640,
  providers: ['anthropic', 'openai'],
  ledger: '~/.auto-runtime/ledger.db',
};

describe('the header of the auto-runtime command', () => {
  it('names the runtime and its version in plain text where there are no colors', () => {
    expect(headerOf('0.7.0', 1)).toBe('\nAuto Runtime v0.7.0\nRuns the playbooks your agent builds\n\n');
  });

  it('draws the logo with the name and the version beside its middle where there are colors', () => {
    const lines = headerOf('0.7.0', 24).split('\n');
    const plain = lines.map((line) => stripVTControlCharacters(line));

    expect(lines).toHaveLength(logoHeight + 3);
    expect(plain[6]).toMatch(/█ {3}Auto Runtime v0\.7\.0$/u);
    expect(plain[7]).toMatch(/ {3}Runs the playbooks your agent builds$/u);
  });
});

describe('the notice that the server is ready', () => {
  it('gives the addresses, the models, the ledger and how to connect an agent', () => {
    expect(readyNoticeOf(ready, 1).split('\n')).toEqual([
      '',
      '  ✔ Ready in 640 ms',
      '',
      '  ➜  Server   http://localhost:5555',
      '  ➜  MCP      http://localhost:5555/mcp',
      '  ➜  Studio   https://studio.on.auto/?server=http%3A%2F%2Flocalhost%3A5555',
      '  ➜  Models   anthropic, openai',
      '  ➜  Ledger   ~/.auto-runtime/ledger.db',
      '',
      '  Connect your agent',
      '    Claude Code   claude mcp add --transport http auto-runtime http://localhost:5555/mcp',
      '    Codex         codex mcp add auto-runtime --url http://localhost:5555/mcp',
      '',
      '  Press Ctrl+C to stop.',
      '',
    ]);
  });

  it('says where a key goes when no model provider is configured', () => {
    expect(readyNoticeOf({ ...ready, providers: [] }, 1)).toContain(
      '  ➜  Models   none yet; put a key such as ANTHROPIC_API_KEY in .env in this directory\n',
    );
  });

  it('links the addresses where the terminal shows colors', () => {
    const notice = readyNoticeOf(ready, 24);

    expect(notice).toContain('\u001B]8;;http://localhost:5555/mcp\u001B\\http://localhost:5555/mcp\u001B]8;;\u001B\\');
    expect(stripVTControlCharacters(notice)).toBe(readyNoticeOf(ready, 1));
  });
});

describe('the notices of a stop', () => {
  it('say that the server is stopping and then that it stopped', () => {
    expect(stoppingNotice(1)).toBe('\n  Stopping…\n');
    expect(stoppedNotice(1)).toBe('  ✔ Stopped\n');
    expect(stripVTControlCharacters(stoppedNotice(24))).toBe(stoppedNotice(1));
  });
});
