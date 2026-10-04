import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';

import { startWorkflow } from '../../../primitives/orchestration/src/interpreter/interpreter.ts';
import { logEngine, type Input } from './log-host.ts';
import { dataDirectory, logFileOf } from './record.ts';
import { scoreOrdersRun } from './workload.ts';

interface Meta {
  readonly node_fields: readonly string[];
  readonly node_types: readonly unknown[];
  readonly edge_fields: readonly string[];
  readonly edge_types: readonly unknown[];
}

interface Snapshot {
  readonly snapshot: { readonly meta: Meta };
  readonly nodes: readonly number[];
  readonly edges: readonly number[];
  readonly strings: readonly string[];
}

function isSnapshot(value: unknown): value is Snapshot {
  return typeof value === 'object' && value !== null && 'nodes' in value && 'edges' in value && 'strings' in value;
}

function namesOf(types: readonly unknown[]): readonly string[] {
  const [first] = types;
  return Array.isArray(first) ? first.map(String) : [];
}

function analyse(file: string): void {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isSnapshot(parsed)) {
    throw new TypeError('Not a heap snapshot');
  }
  const { meta } = parsed.snapshot;
  const width = meta.node_fields.length;
  const edgeWidth = meta.edge_fields.length;
  const field = (name: string): number => meta.node_fields.indexOf(name);
  const [typeAt, nameAt, sizeAt, edgeCountAt] = [field('type'), field('name'), field('self_size'), field('edge_count')];
  const typeNames = namesOf(meta.node_types);
  const edgeTypeNames = namesOf(meta.edge_types);
  const [edgeTypeAt, edgeNameAt, edgeToAt] = ['type', 'name_or_index', 'to_node'].map((name) =>
    meta.edge_fields.indexOf(name),
  );
  const nodeAt = (index: number, at: number): number => parsed.nodes[index * width + at] ?? 0;
  const label = (index: number): string =>
    `${typeNames[nodeAt(index, typeAt)] ?? '?'}:${parsed.strings[nodeAt(index, nameAt)] ?? '?'}`;
  const count = parsed.nodes.length / width;
  const largest = Array.from({ length: count }, (_, index) => index)
    .toSorted((left, right) => nodeAt(right, sizeAt) - nodeAt(left, sizeAt))
    .slice(0, 6);
  const wanted = new Set(largest.map((index) => index * width));
  const retainers = new Map<number, string[]>();
  let edge = 0;
  for (let index = 0; index < count; index += 1) {
    const edges = nodeAt(index, edgeCountAt);
    for (let each = 0; each < edges; each += 1) {
      const offset = (edge + each) * edgeWidth;
      const to = parsed.edges[offset + edgeToAt] ?? 0;
      if (wanted.has(to)) {
        const kind = edgeTypeNames[parsed.edges[offset + edgeTypeAt] ?? 0] ?? '?';
        const nameOrIndex = parsed.edges[offset + edgeNameAt] ?? 0;
        const edgeName =
          kind === 'element' || kind === 'hidden' ? String(nameOrIndex) : (parsed.strings[nameOrIndex] ?? '?');
        const list = retainers.get(to / width) ?? [];
        list.push(`${label(index)} --${kind}:${edgeName}-->`);
        retainers.set(to / width, list);
      }
    }
    edge += edges;
  }
  for (const index of largest) {
    console.log(
      `${nodeAt(index, sizeAt)} bytes ${label(index)} retained by ${JSON.stringify(retainers.get(index)?.slice(0, 4))}`,
    );
  }
  const idAt = field('id');
  const strongRetainer = new Map<number, { from: number; edge: string }>();
  const ephemeronKey = new Map<number, number>();
  const firstEdge: number[] = [];
  let running = 0;
  for (let index = 0; index < count; index += 1) {
    firstEdge.push(running);
    running += nodeAt(index, edgeCountAt);
  }
  for (let index = 0; index < count; index += 1) {
    const edges = nodeAt(index, edgeCountAt);
    for (let each = 0; each < edges; each += 1) {
      const offset = ((firstEdge[index] ?? 0) + each) * edgeWidth;
      const kind = edgeTypeNames[parsed.edges[offset + edgeTypeAt] ?? 0] ?? '?';
      const to = (parsed.edges[offset + edgeToAt] ?? 0) / width;
      const nameOrIndex = parsed.edges[offset + edgeNameAt] ?? 0;
      const edgeName =
        kind === 'element' || kind === 'hidden' || kind === 'internal'
          ? `${kind}#${nameOrIndex}`
          : `${kind}:${parsed.strings[nameOrIndex] ?? '?'}`;
      const ephemeron = kind === 'internal' && label(index).startsWith('object:Object');
      if (
        kind !== 'weak' &&
        kind !== 'shortcut' &&
        !ephemeron &&
        !strongRetainer.has(to) &&
        !edgeName.endsWith('__proto__')
      ) {
        strongRetainer.set(to, { from: index, edge: edgeName });
      }
      if (ephemeron) {
        ephemeronKey.set(to, index);
      }
    }
  }
  const recentObjects = Array.from({ length: count }, (_, index) => index)
    .filter((index) => label(index) === 'object:Object')
    .toSorted((left, right) => nodeAt(right, idAt) - nodeAt(left, idAt))
    .filter((_, position) => position % 4000 === 0)
    .slice(0, 6);
  for (const start of recentObjects) {
    const path: string[] = [];
    const key = ephemeronKey.get(start);
    let at = key ?? start;
    path.push(`value of key ${key === undefined ? 'none' : label(key).slice(0, 30)}`);
    for (let step = 0; step < 14; step += 1) {
      const retainer = strongRetainer.get(at);
      if (retainer === undefined) {
        path.push('(root)');
        break;
      }
      path.push(`${label(retainer.from).slice(0, 50).replaceAll('\n', ' ')} .${retainer.edge}`);
      at = retainer.from;
    }
    console.log(`path of a recent Object: ${path.join('  <-  ')}`);
  }
  const objectRetainers = new Map<string, number>();
  let walked = 0;
  for (let index = 0; index < count; index += 1) {
    const edges = nodeAt(index, edgeCountAt);
    for (let each = 0; each < edges; each += 1) {
      const offset = (walked + each) * edgeWidth;
      const to = (parsed.edges[offset + edgeToAt] ?? 0) / width;
      if (
        label(to) === 'object:Object' &&
        (parsed.strings[parsed.edges[offset + edgeNameAt] ?? 0] ?? '') !== '__proto__'
      ) {
        const kind = edgeTypeNames[parsed.edges[offset + edgeTypeAt] ?? 0] ?? '?';
        const nameOrIndex = parsed.edges[offset + edgeNameAt] ?? 0;
        const edgeName = kind === 'element' || kind === 'hidden' ? '[]' : (parsed.strings[nameOrIndex] ?? '?');
        const key = `${label(index).slice(0, 24)} --${kind}:${kind === 'property' ? edgeName : ''}`;
        objectRetainers.set(key, (objectRetainers.get(key) ?? 0) + 1);
      }
    }
    walked += edges;
  }
  for (const [key, many] of [...objectRetainers.entries()].toSorted((left, right) => right[1] - left[1]).slice(0, 12)) {
    console.log(`retains Object x${many}: ${key.replaceAll('\n', ' ')}`);
  }
  const totals = new Map<string, { count: number; bytes: number }>();
  for (let index = 0; index < count; index += 1) {
    const key = label(index).slice(0, 60);
    const total = totals.get(key) ?? { count: 0, bytes: 0 };
    total.count += 1;
    total.bytes += nodeAt(index, sizeAt);
    totals.set(key, total);
  }
  for (const [key, { count: many, bytes }] of [...totals.entries()]
    .toSorted((left, right) => right[1].count - left[1].count)
    .slice(0, 18)) {
    console.log(`${String(many).padStart(9)} ${String(bytes).padStart(11)}  ${key.replaceAll('\n', ' ')}`);
  }
}

function inputsUpTo(size: number): readonly Input[] {
  const all: unknown = JSON.parse(readFileSync(logFileOf(40_000), 'utf8'));
  return typeof all === 'object' && all !== null && 'inputs' in all && Array.isArray(all.inputs)
    ? all.inputs.slice(0, size)
    : [];
}

const size = Number(process.argv[2] ?? '10000');
const engine = logEngine('lean');
await engine.start((host) => startWorkflow(scoreOrdersRun(), host));
let inputs = inputsUpTo(size);
for (const input of inputs) {
  await engine.apply(input);
}
inputs = [];
const file = writeHeapSnapshot(join(dataDirectory, `census-${size}.heapsnapshot`));
analyse(file);
rmSync(file);
console.log(engine.commands());
