import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { providerStatus } from '@beonauto/reasoning';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { stoppedWith } from '../testing/processes/development-endings.ts';
import {
  developmentFiles,
  developmentTestTimeoutMs,
  readyNoticesOf,
  startDevelopment,
  untilListening,
  untilWritten,
  type DevelopmentOptions,
} from '../testing/processes/development-process.ts';

const example = new URL('../../../../.env.example', import.meta.url);

const exampleConfigFile = fileURLToPath(new URL('../../../../auto-brain.example.yaml', import.meta.url));

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

  it('documents the model settings in .env.example and auto-brain.example.yaml in a form that reads as written', () => {
    const environment = parseEnv(uncommented(readFileSync(example, 'utf8')));

    const { models, allowedOrigins, configFile } = readSettings({ ...environment, CONFIG_FILE: exampleConfigFile });

    expect(providerStatus(models, { entraId: false }).configured).toEqual(['anthropic', 'openai', 'google', 'gateway']);
    expect(Object.fromEntries(models.aliases)).toEqual({ 'anthropic/*': 'gateway/anthropic/*' });
    expect(allowedOrigins).toEqual(['http://localhost:5173']);
    expect(configFile?.fromFile).toEqual(['MODEL_GATEWAYS', 'MODEL_ALIASES', 'ALLOWED_ORIGINS']);
  });

  it('documents the ledger in PostgreSQL in .env.example in a form that reads as written over dev.env', () => {
    const environment = parseEnv(uncommented(readFileSync(example, 'utf8')));

    const { ledger } = readSettings({ LEDGER_FILE: '.data/ledger.db', ...environment });

    expect(ledger).toMatchObject({ store: 'postgresql', host: '127.0.0.1:5432', database: 'postgres' });
  });
});

describe('the configuration file pnpm dev passes', { timeout: developmentTestTimeoutMs }, () => {
  it('is auto-brain.yaml at the root of the repository, when it is there', async () => {
    const files = developmentFiles();
    writeFileSync(files.configFile, 'model_aliases:\n  house/fast: anthropic/claude-haiku-4-5\n');
    const development = startDevelopment(files);

    await untilListening(development);
    await stoppedWith(development, 'SIGTERM');

    expect(development.stderr()).toContain(
      `"message":"Settings read from the configuration file ${files.configFile}: MODEL_ALIASES"`,
    );
  });

  it('is the one CONFIG_FILE names instead, which the ready notice reads too', async () => {
    const files = developmentFiles();
    const named = join(files.directory, 'gateways.yaml');
    writeFileSync(files.configFile, 'model_aliases:\n  house/fast: anthropic/claude-haiku-4-5\n');
    writeFileSync(named, 'model_gateways:\n  - name: relay\n    base_url: https://relay.example.com/v1\n');
    writeFileSync(files.localEnvFile, `CONFIG_FILE=${named}\n`);
    const development = startDevelopment(files);

    await untilWritten(development.stderr, /auto-brain is ready/u);
    await stoppedWith(development, 'SIGTERM');

    expect(development.stderr()).toContain(
      `"message":"Settings read from the configuration file ${named}: MODEL_GATEWAYS"`,
    );
    expect(readyNoticesOf(development)).toEqual([expect.stringContaining('  models     relay\n')]);
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
      expect.stringMatching(/^INFO {2}The ledger is kept in the file \S+\/ledger\.db ledger_file=\S+\/ledger\.db$/u),
      expect.stringMatching(/^WARN {2}No model provider is configured, /u),
      expect.stringMatching(/^INFO {2}Reasoning functions run in this server: the model calls of a run add up to /u),
      expect.stringMatching(/^INFO {2}Workflows run in this server: a run lasts at most 30 days, /u),
      'INFO  [dev] auto-brain is ready',
      `  server     http://localhost:${port}`,
      '  models     none configured; copy .env.example to .env and put a key in it',
      `  MCP        http://localhost:${port}/mcp`,
      '',
    ]);
  });
});
