import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { bundleWorkflowCode, DefaultLogger } from '@temporalio/worker';
import { Data, Option, Schema } from 'effect';

import { failureConverterPath, workflowsPath, workspaceRoot } from './workflow-code.ts';

export class WorkflowBundleInvalid extends Data.TaggedError('workflow_bundle_invalid')<{ readonly message: string }> {}

type Digest = readonly [file: string, digest: string];

const codeFile = 'workflow-bundle.js';

const manifestFile = 'workflow-bundle.json';

const mostChangesNamed = 5;

const sourceDirectory = 'primitives/orchestration/src';

const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ code: Schema.String, inputs: Schema.Record(Schema.String, Schema.String) })),
);

export async function buildWorkflowBundle(directory: string): Promise<string> {
  const { code } = await bundleWorkflowCode({ workflowsPath, failureConverterPath, logger: new DefaultLogger('WARN') });
  const inputs = await Promise.all((await bundleInputs()).map((file) => digestEntryOf(file)));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, codeFile), code);
  const manifest = { code: sha256(code), inputs: Object.fromEntries(inputs) };
  await writeFile(join(directory, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);
  return join(directory, codeFile);
}

export async function verifiedWorkflowBundle(directory: string): Promise<string> {
  const manifest = Option.getOrUndefined(decodeManifest(await textOf(join(directory, manifestFile))));
  const codePath = join(directory, codeFile);
  const code = await textOf(codePath);
  if (manifest === undefined || code === '') {
    throw new WorkflowBundleInvalid({ message: `There is no complete workflow bundle in ${directory}` });
  }
  const changed = await changedInputs(manifest.inputs);
  if (sha256(code) !== manifest.code || changed.length > 0) {
    const named = changed.length > 0 ? changed.slice(0, mostChangesNamed).join(', ') : codeFile;
    throw new WorkflowBundleInvalid({
      message: `The workflow bundle in ${directory} was built from other code than this server runs: ${named} changed`,
    });
  }
  return codePath;
}

async function bundleInputs(): Promise<readonly string[]> {
  const patches = await readdir(join(workspaceRoot, 'patches'));
  const sources = await readdir(join(workspaceRoot, sourceDirectory), { recursive: true });
  return [
    'pnpm-lock.yaml',
    ...patches.map((patch) => `patches/${patch}`),
    ...sources.filter((file) => isWorkflowSource(file)).map((file) => `${sourceDirectory}/${file}`),
  ].toSorted();
}

function isWorkflowSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('testing');
}

async function changedInputs(inputs: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const checked = await Promise.all(
    Object.entries(inputs).map(async ([file, digest]: Digest) => ((await digestOf(file)) === digest ? [] : [file])),
  );
  return checked.flat();
}

async function digestEntryOf(file: string): Promise<Digest> {
  return [file, await digestOf(file)];
}

function digestOf(file: string): Promise<string> {
  return readFile(join(workspaceRoot, file), 'utf8').then(
    (content) => sha256(content),
    () => 'missing',
  );
}

function textOf(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
