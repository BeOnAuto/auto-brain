import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildBundleCommand, checkBundleCommand, type CommandOutput } from './bundle-commands.ts';

interface Recorded {
  readonly output: CommandOutput;
  readonly lines: () => readonly string[];
}

function recorded(): Recorded {
  const lines: string[] = [];
  return {
    output: {
      out: (line) => {
        lines.push(`out: ${line}`);
      },
      error: (line) => {
        lines.push(`error: ${line}`);
      },
    },
    lines: () => lines,
  };
}

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'bundle-commands-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the commands that build and check a workflow bundle', () => {
  it('build a bundle into the directory named, and check it against this code', async () => {
    const building = recorded();
    const checking = recorded();
    const bundle = join(directory, 'bundle');

    const built = await buildBundleCommand([bundle], building.output);
    const checked = await checkBundleCommand([bundle], checking.output);

    expect([built, checked]).toStrictEqual([0, 0]);
    expect([...building.lines(), ...checking.lines()]).toStrictEqual([
      `out: Built the workflow bundle ${join(bundle, 'workflow-bundle.js')}`,
      `out: The workflow bundle ${join(bundle, 'workflow-bundle.js')} matches this code, and Temporal's native bridge loads`,
    ]);
  }, 60_000);

  it('say how to call them when no directory is named, and fail', async () => {
    const building = recorded();
    const checking = recorded();

    const codes = [await buildBundleCommand([], building.output), await checkBundleCommand([], checking.output)];

    expect(codes).toStrictEqual([1, 1]);
    expect([...building.lines(), ...checking.lines()]).toStrictEqual([
      'error: Name the directory to write the workflow bundle to: node build-workflow-bundle.ts <directory>',
      'error: Name the directory of the workflow bundle: node check-workflow-bundle.ts <directory>',
    ]);
  });

  it('fail the check of a directory without a bundle', async () => {
    await expect(checkBundleCommand([join(directory, 'nothing')], recorded().output)).rejects.toMatchObject({
      _tag: 'workflow_bundle_invalid',
    });
  });
});
