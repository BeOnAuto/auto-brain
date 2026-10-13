import { fileURLToPath } from 'node:url';

import { describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer, spawnedServerTestTimeoutMs } from '../testing/processes/spawned-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ':memory:' };

describe('the server with LOG_FORMAT=pretty', { timeout: spawnedServerTestTimeoutMs }, () => {
  it('writes its logs as readable lines to stderr, and still exactly the listening line to stdout', async () => {
    const { cacheDirectory, remove } = temporaryLedger();
    onTestFinished(remove);
    const child = spawnServer(mainModule, {
      ...loopback,
      LOCAL_MODE: 'true',
      LOG_FORMAT: 'pretty',
      PREDICTION_CACHE_DIR: cacheDirectory,
    });
    const port = await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
    expect(
      child
        .output()
        .stderr.split('\n')
        .map((line) => line.replace(/^\d{2}:\d{2}:\d{2}\.\d{3} /u, '')),
    ).toEqual([
      expect.stringMatching(/^WARN {2}Local mode is on: /u),
      'INFO  The ledger is kept in the file :memory: ledger_file=:memory:',
      "INFO  Content is kept in the ledger's database content_store=ledger",
      expect.stringMatching(/^WARN {2}No model provider is configured, .* providers=\[\{"provider":"anthropic",/u),
      "INFO  Reasoning functions run in this server: the model calls of a run add up to at most 2,000,000 input tokens, and each answer of a tool is read whole where it fits the model's context window most_input_tokens=2000000",
      `INFO  Prediction functions run in this server: a playbook keeps at most 32 active, each builds at most 4 times a day, and model processes may run at most 4 at once, at most 2 of them for the builds being scored, with 1,280 MiB of data each, which nothing bounds, since prlimit is not on the path, reading the files of their models from ${cacheDirectory} most_functions=32 model_processes=4 model_process_memory_mib=1280 model_process_builds=2 builds_per_day=4 model_cache_directory=${cacheDirectory} model_process_limiter=null`,
      'INFO  Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms most_duration_ms=2592000000 most_calls_at_once=32 sweep_every_ms=1000',
      '',
    ]);
  });
});
