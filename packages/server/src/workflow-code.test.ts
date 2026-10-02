import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWorkflowBundle } from '@beonauto/orchestration';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { temporaryLedger } from './testing/temporary-ledger.ts';
import { loggedWithin, workflowProcess } from './testing/workflow-process.ts';
import { workflowTestTimeoutMs } from './testing/workflow-server.ts';

const withoutBundler = `--import ${fileURLToPath(new URL('testing/without-bundler.ts', import.meta.url))}`;

const ledger = temporaryLedger();

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'server-workflow-code-'));
  await buildWorkflowBundle(directory);
}, workflowTestTimeoutMs);

afterAll(async () => {
  ledger.remove();
  await rm(directory, { recursive: true, force: true });
});

function plainLinesOf(text: string): readonly string[] {
  return text.split('\n').filter((line) => !line.startsWith('{') && line !== '');
}

function workerStarted(message: string): boolean {
  return message === 'The workflow worker started';
}

describe('a server without the workflow bundler, as in the image', { timeout: workflowTestTimeoutMs }, () => {
  it('runs its worker on the bundle built ahead of time', async () => {
    const child = workflowProcess(ledger.fileName, inject('temporalAddress'), `server-${randomUUID()}`, {
      ORCHESTRATION_WORKFLOW_BUNDLE: directory,
      NODE_OPTIONS: withoutBundler,
    });
    await child.port;

    const worker = await loggedWithin(child, workerStarted, 160);
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect(worker?.message).toBe('The workflow worker started');
    expect(exitCode).toBe(0);
  });

  it('does not start without such a bundle, saying so in one line', async () => {
    const child = workflowProcess(ledger.fileName, inject('temporalAddress'), `server-${randomUUID()}`, {
      NODE_OPTIONS: withoutBundler,
    });

    const exitCode = await child.exited;
    const failures = plainLinesOf(child.output().stderr);

    expect(exitCode).toBe(1);
    expect(failures).toStrictEqual([
      'auto-brain could not start: workflow_bundle_invalid: ORCHESTRATION_WORKFLOW_BUNDLE is not set, and the workflow code cannot be bundled here because the bundler swc is not installed; set ORCHESTRATION_WORKFLOW_BUNDLE to a bundle built ahead of time, /app/workflow-bundle in the image',
    ]);
  });
});
