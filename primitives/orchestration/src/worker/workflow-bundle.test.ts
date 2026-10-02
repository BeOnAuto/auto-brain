import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildWorkflowBundle, verifiedWorkflowBundle } from './workflow-bundle.ts';

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ code: Schema.String, inputs: Schema.Record(Schema.String, Schema.String) })),
);

let directory: string;

let built: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'workflow-bundle-'));
  built = await buildWorkflowBundle(join(directory, 'bundle'));
}, 60_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function copiedBundle(name: string): Promise<string> {
  const copy = join(directory, name);
  await cp(join(directory, 'bundle'), copy, { recursive: true });
  return copy;
}

async function changedFile(path: string, change: (text: string) => string): Promise<void> {
  await writeFile(path, change(await readFile(path, 'utf8')));
}

describe('a workflow bundle built ahead of time', () => {
  it('is the code a worker loads, built from the sources and the lockfile this server runs', async () => {
    const manifest = decodeManifest(await readFile(join(directory, 'bundle', 'workflow-bundle.json'), 'utf8'));
    const inputs = Object.keys(manifest.inputs);

    expect(await verifiedWorkflowBundle(join(directory, 'bundle'))).toBe(built);
    expect(inputs).toContain('pnpm-lock.yaml');
    expect(inputs).toContain('patches/@gabrielbryk__jq-ts@1.7.0.patch');
    expect(inputs).toContain('primitives/orchestration/src/workflow/workflows.ts');
    expect(inputs.filter((file) => /\.test\.ts$|\/testing\//u.test(file))).toEqual([]);
    expect(Object.values(manifest.inputs).filter((digest) => !/^[0-9a-f]{64}$/u.test(digest))).toEqual([]);
  });
});

describe('a workflow bundle that does not match the server', () => {
  it('is refused when one of the files it was built from has changed since, naming the file', async () => {
    const copy = await copiedBundle('stale');
    await changedFile(join(copy, 'workflow-bundle.json'), (text) =>
      text.replace(/("primitives\/orchestration\/src\/workflow\/workflows\.ts": ")[0-9a-f]{64}/u, '$1changed'),
    );

    await expect(verifiedWorkflowBundle(copy)).rejects.toMatchObject({
      _tag: 'workflow_bundle_invalid',
      message: `The workflow bundle in ${copy} was built from other code than this server runs: primitives/orchestration/src/workflow/workflows.ts changed`,
    });
  });

  it('is refused when one of the files it was built from is gone', async () => {
    const copy = await copiedBundle('gone');
    await changedFile(join(copy, 'workflow-bundle.json'), (text) =>
      text.replace(
        '"primitives/orchestration/src/workflow/workflows.ts"',
        '"primitives/orchestration/src/workflow/gone.ts"',
      ),
    );

    await expect(verifiedWorkflowBundle(copy)).rejects.toMatchObject({
      message: `The workflow bundle in ${copy} was built from other code than this server runs: primitives/orchestration/src/workflow/gone.ts changed`,
    });
  });

  it('is refused when its code is not what was built', async () => {
    const copy = await copiedBundle('edited');
    await changedFile(join(copy, 'workflow-bundle.js'), (text) => `${text}\n`);

    await expect(verifiedWorkflowBundle(copy)).rejects.toMatchObject({
      message: `The workflow bundle in ${copy} was built from other code than this server runs: workflow-bundle.js changed`,
    });
  });

  it('is refused when it is missing or incomplete', async () => {
    const copy = await copiedBundle('incomplete');
    await rm(join(copy, 'workflow-bundle.json'));

    await expect(verifiedWorkflowBundle(copy)).rejects.toMatchObject({
      message: `There is no complete workflow bundle in ${copy}`,
    });
    await expect(verifiedWorkflowBundle(join(directory, 'nowhere'))).rejects.toMatchObject({
      message: `There is no complete workflow bundle in ${join(directory, 'nowhere')}`,
    });
  });
});
