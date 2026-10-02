import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildWorkflowBundle } from '@beonauto/orchestration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, type InferenceServer } from '../testing/inference-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/workflow-server.ts';

const greeting = workflowSource('greeting', 'do:\n  - greet: { set: { greeting: \'${ "Hello, " + .name }\' } }\n');

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'server-workflow-bundle-'));
  await buildWorkflowBundle(join(directory, 'built'));
}, workflowTestTimeoutMs);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a server given a workflow bundle built ahead of time', { timeout: workflowTestTimeoutMs }, () => {
  it('runs workflows with it', async () => {
    const server: InferenceServer = await servingWorkflows([], {
      LOCAL_MODE: 'true',
      ORCHESTRATION_WORKFLOW_BUNDLE: join(directory, 'built'),
    });
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'greeting', source: greeting } });

    const started = await server.call('POST', `${alpha}/specs/orchestration/greeting/execute`, {
      body: { input: { name: 'Ada' } },
    });
    const settled = await settledExecution(server, `${alpha}/executions/${executionIdIn(started.body)}`);
    await server.stop();

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: { greeting: 'Hello, Ada' } } });
  });

  it('does not start when the bundle was built from other code, naming what changed', async () => {
    const manifestPath = join(directory, 'built', 'workflow-bundle.json');
    const manifest = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, manifest.replace(/("pnpm-lock\.yaml": ")[0-9a-f]{64}/u, '$1stale'));

    const starting = servingWorkflows([], {
      LOCAL_MODE: 'true',
      ORCHESTRATION_WORKFLOW_BUNDLE: join(directory, 'built'),
    });
    await expect(starting).rejects.toMatchObject({
      _tag: 'workflow_bundle_invalid',
      message: `The workflow bundle in ${join(directory, 'built')} was built from other code than this server runs: pnpm-lock.yaml changed`,
    });
    await writeFile(manifestPath, manifest);
  });

  it('does not start when there is no bundle where it was told to look', async () => {
    await expect(
      servingWorkflows([], { LOCAL_MODE: 'true', ORCHESTRATION_WORKFLOW_BUNDLE: join(directory, 'missing') }),
    ).rejects.toMatchObject({ message: `There is no complete workflow bundle in ${join(directory, 'missing')}` });
  });
});
