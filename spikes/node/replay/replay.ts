import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';

import { runExpression } from '../../../primitives/orchestration/src/dsl/expressions.ts';
import { measureOf } from '../../../primitives/orchestration/src/dsl/json.ts';
import { retainedBytesOf } from '../../../primitives/orchestration/src/dsl/retained-size.ts';
import { startWorkflow } from '../../../primitives/orchestration/src/interpreter/interpreter.ts';
import { logEngine, type Input, type ScopeKind } from './log-host.ts';
import { logFileOf, type RecordedLog } from './record.ts';
import { scoreOrdersRun } from './workload.ts';

const mebibyte = 1_048_576;

function touchTheCaches(): void {
  for (let round = 0; round < 3; round += 1) {
    measureOf({ round });
    retainedBytesOf({ round });
    runExpression('.', { round }, {}, { now: 0, mostWork: 1000 });
    collect();
  }
}

function collect(): number {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

function isRecordedLog(value: unknown): value is RecordedLog {
  return typeof value === 'object' && value !== null && 'inputs' in value && 'digest' in value;
}

async function replay(size: number, scopes: ScopeKind, streamed: boolean): Promise<object> {
  const heapAtStart = collect();
  let text = readFileSync(logFileOf(size), 'utf8');
  const logBytes = Buffer.byteLength(text);
  const parsing = performance.now();
  let log: unknown = JSON.parse(text);
  const parseMs = performance.now() - parsing;
  if (!isRecordedLog(log)) {
    throw new TypeError('Not a recorded log');
  }
  let inputs: (Input | undefined)[] = [...log.inputs];
  const recorded = { inputs: log.inputs.length, digest: log.digest, commands: log.commands };
  log = undefined;
  text = '';
  const heapWithLog = collect();
  let peakHeap = 0;
  const cpu = process.cpuUsage();
  const began = performance.now();
  const engine = logEngine(scopes);
  await engine.start((host) => startWorkflow(scoreOrdersRun(), host));
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (input === undefined) {
      throw new Error(`Input ${index} is missing`);
    }
    if (streamed) {
      inputs[index] = undefined;
    }
    await engine.apply(input);
    if (index % 500 === 0) {
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
  }
  const wallMs = performance.now() - began;
  const { user, system } = process.cpuUsage(cpu);
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  const faithful = engine.digest() === recorded.digest && engine.commands() === recorded.commands;
  inputs = [];
  const heapRetained = collect() - heapAtStart;
  touchTheCaches();
  const heapRetainedAfterCachesShrink = collect() - heapAtStart;
  return {
    size,
    scopes,
    streamed,
    inputs: recorded.inputs,
    faithful,
    activations: engine.activations(),
    commands: engine.commands(),
    wallMs: Math.round(wallMs),
    cpuMs: Math.round((user + system) / 1000),
    microsPerInput: Math.round((wallMs * 1000) / recorded.inputs),
    parseMs: Math.round(parseMs),
    logMiB: +(logBytes / mebibyte).toFixed(2),
    heapLogMiB: +((heapWithLog - heapAtStart) / mebibyte).toFixed(1),
    peakHeapAboveStartMiB: +((peakHeap - heapAtStart) / mebibyte).toFixed(1),
    retainedRunMiB: +(heapRetained / mebibyte).toFixed(1),
    retainedAfterCachesShrinkMiB: +(heapRetainedAfterCachesShrink / mebibyte).toFixed(1),
    maxRssMiB: Math.round((process.resourceUsage().maxRSS * 1024) / mebibyte),
    waitingAtEnd: engine.waiting().map(({ kind }) => kind),
  };
}

async function setImmediateBaseline(size: number): Promise<object> {
  const began = performance.now();
  for (let index = 0; index < size; index += 1) {
    await setImmediate();
  }
  const wallMs = performance.now() - began;
  return {
    size,
    baseline: 'setImmediate per input',
    wallMs: Math.round(wallMs),
    microsPerInput: +((wallMs * 1000) / size).toFixed(2),
  };
}

const [mode = 'replay', sizeText = '1000', scopes = 'lean', reading = 'held'] = process.argv.slice(2);
const size = Number(sizeText);
console.log(
  JSON.stringify(
    mode === 'baseline'
      ? await setImmediateBaseline(size)
      : await replay(size, scopes === 'fake' ? 'fake' : 'lean', reading === 'streamed'),
  ),
);
