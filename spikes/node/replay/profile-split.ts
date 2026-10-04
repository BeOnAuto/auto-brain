import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

interface ProfileNode {
  readonly id: number;
  readonly callFrame: { readonly url: string; readonly functionName: string };
}

interface Profile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
}

function isProfile(value: unknown): value is Profile {
  return typeof value === 'object' && value !== null && 'nodes' in value && 'samples' in value;
}

function bucketOf({ url, functionName }: ProfileNode['callFrame']): string {
  if (url.includes('jq-ts')) {
    return 'jq-ts (expression evaluation)';
  }
  if (url.includes('orchestration/src/dsl')) {
    return 'orchestration dsl (json measure, retained size, expressions glue)';
  }
  if (url.includes('orchestration/src/interpreter')) {
    return 'orchestration interpreter';
  }
  if (url.includes('orchestration/src/testing') || url.includes('spikes/node')) {
    return 'log host and cancellation scopes';
  }
  if (functionName === '(garbage collector)') {
    return 'garbage collector';
  }
  if (functionName === '(idle)' || functionName === '(program)' || functionName === '(root)') {
    return `${functionName}`;
  }
  return url.startsWith('node:') || url === ''
    ? 'node internals and builtins (promises, async context, timers)'
    : 'other';
}

const size = process.argv[2] ?? '10000';
const directory = join(import.meta.dirname, '..', '.data', `profile-${size}`);
rmSync(directory, { recursive: true, force: true });
const profiled = spawnSync(
  process.execPath,
  ['--cpu-prof', `--cpu-prof-dir=${directory}`, 'replay.ts', 'replay', size],
  {
    cwd: import.meta.dirname,
    encoding: 'utf8',
  },
);
console.log(profiled.stdout.trim());
const [file] = readdirSync(directory).filter((name) => name.endsWith('.cpuprofile'));
if (file === undefined) {
  throw new Error(`No .cpuprofile in ${directory}`);
}
const profile: unknown = JSON.parse(readFileSync(join(directory, file), 'utf8'));
if (!isProfile(profile)) {
  throw new TypeError('Not a CPU profile');
}
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const counts = new Map<string, number>();
for (const sample of profile.samples) {
  const node = byId.get(sample);
  const bucket = node === undefined ? 'unknown' : bucketOf(node.callFrame);
  counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
}
const busy = [...counts.entries()].filter(([bucket]) => bucket !== '(idle)');
const total = busy.reduce((sum, [, count]) => sum + count, 0);
console.log(
  JSON.stringify(
    Object.fromEntries(
      busy
        .toSorted((left, right) => right[1] - left[1])
        .map(([bucket, count]) => [bucket, `${Math.round((count / total) * 100)}%`]),
    ),
  ),
);

const ownFunctions = new Map<string, number>();
for (const sample of profile.samples) {
  const node = byId.get(sample);
  if (node !== undefined && node.callFrame.url.includes('orchestration/src/')) {
    const name = `${node.callFrame.url.split('orchestration/src/')[1] ?? '?'} ${node.callFrame.functionName}`;
    ownFunctions.set(name, (ownFunctions.get(name) ?? 0) + 1);
  }
}
for (const [name, count] of [...ownFunctions.entries()].toSorted((left, right) => right[1] - left[1]).slice(0, 10)) {
  console.log(`${String(Math.round((count / total) * 1000) / 10).padStart(5)}%  ${name}`);
}
