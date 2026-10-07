import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, onTestFinished } from 'vitest';

const poolTestTimeoutMs = 30_000;

const reading = new URL(
  `data:text/javascript,${encodeURIComponent(
    [
      "import { parentPort } from 'node:worker_threads';",
      "parentPort.on('message', ({ job }) => {",
      '  const output = JSON.stringify({ environment: Object.keys(process.env), flags: process.execArgv, preloaded: globalThis.preloaded === true });',
      "  parentPort.postMessage({ job, answer: { ran: 'answered', output, bytes: output.length, work: 0 }, keep: true });",
      '});',
    ].join('\n'),
  )}`,
);

const server = [
  `const { liftedLimits, programPool } = await import(${JSON.stringify(new URL('program-pool.ts', import.meta.url).href)});`,
  `const pool = programPool({ workers: 1, heapMegabytes: 64, worker: new URL(${JSON.stringify(reading.href)}) });`,
  "const outcome = await pool.run({ source: '.', input: null, dialect: { refused: [] }, limits: liftedLimits(1000000), deadlineMs: 10000, mostOutputBytes: 1000 });",
  'await pool.close();',
  'process.stdout.write(JSON.stringify({ secret: process.env.WORKER_SECRET, preloaded: globalThis.preloaded === true, outcome }));',
].join('\n');

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'worker-flags-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

async function printedBy(nodeArguments: readonly string[]): Promise<string> {
  const child = spawn(process.execPath, nodeArguments, { stdio: ['ignore', 'pipe', 'inherit'] });
  onTestFinished(() => {
    child.kill('SIGKILL');
  });
  const printed = { text: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    printed.text += chunk;
  });
  await once(child, 'close');
  return printed.text;
}

describe('the flags of a worker', { timeout: poolTestTimeoutMs }, () => {
  it("are none of the server's, so neither the env file nor the preload the server started with reaches a program's worker", async () => {
    const directory = temporaryDirectory();
    const envFile = join(directory, 'server.env');
    const preload = join(directory, 'preload.mjs');
    writeFileSync(envFile, 'WORKER_SECRET=x\n');
    writeFileSync(preload, 'globalThis.preloaded = true;\n');

    const printed = await printedBy([
      `--env-file=${envFile}`,
      `--import=${pathToFileURL(preload).href}`,
      '--eval',
      server,
    ]);

    expect(JSON.parse(printed)).toMatchObject({
      secret: 'x',
      preloaded: true,
      outcome: { ran: 'answered', output: { environment: [], flags: [], preloaded: false } },
    });
  });
});
