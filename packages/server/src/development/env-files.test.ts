import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { providerStatus, readModelSettings } from '@beonauto/inference';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  developmentFiles,
  developmentTestTimeoutMs,
  startDevelopment,
  untilListening,
  untilWritten,
  type DevelopmentOptions,
} from '../testing/development-process.ts';
import { stoppedWith } from '../testing/development-workflows.ts';

const example = new URL('../../../../.env.example', import.meta.url);

const localMode = '"message":"Local mode is on:';

const closed = '"message":"No request can authenticate:';

async function accessNoticeWith(localEnvFile: string, options: DevelopmentOptions): Promise<string> {
  const files = developmentFiles('HOST=127.0.0.1\nLOCAL_MODE=false\n');
  writeFileSync(files.localEnvFile, localEnvFile);
  const development = startDevelopment(files, options);
  await untilListening(development);
  await stoppedWith(development, 'SIGTERM');
  return [localMode, closed].filter((notice) => development.stderr().includes(notice)).join();
}

function uncommented(text: string): string {
  return text.replaceAll(/^# (?=[A-Z_]+=)/gmu, '');
}

describe('the settings files pnpm dev reads', { timeout: developmentTestTimeoutMs }, () => {
  it('lets .env override dev.env', async () => {
    await expect(accessNoticeWith('LOCAL_MODE=true\n', {})).resolves.toBe(localMode);
  });

  it('lets a variable set in the shell win over both files', async () => {
    await expect(accessNoticeWith('LOCAL_MODE=true\n', { environment: { LOCAL_MODE: 'false' } })).resolves.toBe(closed);
  });

  it('documents every model setting in .env.example in a form that reads as written', async () => {
    const settings = parseEnv(uncommented(readFileSync(example, 'utf8')));

    const models = await Effect.runPromise(readModelSettings(settings));

    expect(providerStatus(models, { entraId: false }).configured).toEqual(['anthropic', 'openai', 'google', 'gateway']);
    expect(Object.fromEntries(models.aliases)).toEqual({
      'anthropic/*': 'gateway/anthropic/*',
    });
  });
});

describe('pnpm dev with LOG_FORMAT=pretty in dev.env', { timeout: developmentTestTimeoutMs }, () => {
  it("writes its own lines and the server's as readable lines", async () => {
    const development = startDevelopment(developmentFiles('HOST=127.0.0.1\nLOCAL_MODE=true\nLOG_FORMAT=pretty\n'));

    const port = await untilListening(development);
    await untilWritten(development.stderr, /\[dev\] auto-brain is ready/u);
    await stoppedWith(development, 'SIGTERM');

    expect(
      development
        .stderr()
        .replaceAll(/^\d{2}:\d{2}:\d{2}\.\d{3} /gmu, '')
        .split('\n'),
    ).toEqual([
      expect.stringMatching(/^WARN {2}Local mode is on: /u),
      expect.stringMatching(/^WARN {2}No model provider is configured, /u),
      'INFO  Workflows are not offered because TEMPORAL_ADDRESS is unset',
      'INFO  [dev] auto-brain is ready',
      `  server     http://localhost:${port}`,
      '  workflows  off',
      '  models     none configured; copy .env.example to .env and put a key in it',
      `  MCP        http://localhost:${port}/mcp`,
      '',
    ]);
  });
});
