import { describe, expect, it } from 'vitest';

import { readyNotice } from './ready-notice.ts';

describe('the notice that pnpm dev is ready', () => {
  it('gives the server, the configured model providers and the MCP endpoint', () => {
    const notice = readyNotice(8080, { OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant-test' });

    expect(notice.split('\n')).toEqual([
      'auto-brain is ready',
      '  server     http://localhost:8080',
      '  models     anthropic, openai',
      '  MCP        http://localhost:8080/mcp',
    ]);
  });

  it('says where a key goes when no model provider is configured', () => {
    expect(readyNotice(8080, {}).split('\n')[2]).toBe(
      '  models     none configured; copy .env.example to .env and put a key in it',
    );
  });
});
