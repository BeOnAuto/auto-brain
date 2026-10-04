import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { bundleWorkflowCode, DefaultLogger } from '@temporalio/worker';
import { Data, Option, Schema } from 'effect';

import { failureConverterPath, workflowsPath, workspaceRoot } from './workflow-code.ts';

export class WorkflowBundleInvalid extends Data.TaggedError('workflow_bundle_invalid')<{ readonly message: string }> {}

type Digest = readonly [file: string, digest: string];

const codeFile = 'workflow-bundle.js';

const manifestFile = 'workflow-bundle.json';

const mostChangesNamed = 5;

const sourceDirectories = ['packages/workflow-engine/src', 'primitives/orchestration/src'];

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
  const changes = await inputChanges(manifest.inputs);
  if (sha256(code) !== manifest.code || changes.length > 0) {
    const named = changes.length > 0 ? changes.slice(0, mostChangesNamed).join(', ') : `${codeFile} changed`;
    throw new WorkflowBundleInvalid({
      message: `The workflow bundle in ${directory} was built from other code than this server runs: ${named}`,
    });
  }
  return codePath;
}

export function requireWorkflowBundler(): void {
  try {
    createRequire(import.meta.resolve('@temporalio/worker'))('@swc/core');
  } catch {
    throw new WorkflowBundleInvalid({
      message:
        'ORCHESTRATION_WORKFLOW_BUNDLE is not set, and the workflow code cannot be bundled here because the bundler swc is not installed; set ORCHESTRATION_WORKFLOW_BUNDLE to a bundle built ahead of time, /app/workflow-bundle in the image',
    });
  }
}

async function bundleInputs(): Promise<readonly string[]> {
  const patches = await readdir(join(workspaceRoot, 'patches'));
  const sources = await Promise.all(sourceDirectories.map((directory) => workflowSourcesIn(directory)));
  return ['pnpm-lock.yaml', ...patches.map((patch) => `patches/${patch}`), ...sources.flat()].toSorted();
}

async function workflowSourcesIn(directory: string): Promise<readonly string[]> {
  const files = await readdir(join(workspaceRoot, directory), { recursive: true });
  return files.filter((file) => isWorkflowSource(file)).map((file) => `${directory}/${file}`);
}

function isWorkflowSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('testing');
}

async function inputChanges(recorded: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const current = new Map(await Promise.all((await bundleInputs()).map((file) => digestEntryOf(file))));
  const files = [...new Set([...Object.keys(recorded), ...current.keys()])].toSorted();
  return files.flatMap((file) => changeOf(file, recorded[file], current.get(file)));
}

function changeOf(file: string, built: string | undefined, running: string | undefined): readonly string[] {
  if (built === undefined) {
    return [`${file} is new`];
  }
  if (running === undefined) {
    return [`${file} is gone`];
  }
  return built === running ? [] : [`${file} changed`];
}

async function digestEntryOf(file: string): Promise<Digest> {
  return [file, await digestOf(file)];
}

async function digestOf(file: string): Promise<string> {
  return sha256(await readFile(join(workspaceRoot, file), 'utf8'));
}

function textOf(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
