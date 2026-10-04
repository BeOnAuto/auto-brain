import { startWorkflow } from '../../../primitives/orchestration/src/interpreter/interpreter.ts';
import { runFor } from '../../../primitives/orchestration/src/testing/workflows.ts';
import { logEngine } from './log-host.ts';
import { runInput, scoreOrders, world } from './workload.ts';

const mebibyte = 1_048_576;

function collect(): number {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

function detachedDocument(): typeof scoreOrders {
  const text = JSON.stringify(scoreOrders).replace(
    '"customer":"${ .customer }"',
    '"customer":"${ .customer | tojson | fromjson }"',
  );
  const value: unknown = JSON.parse(text);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

async function retainedAfter(size: number, detached: boolean): Promise<number> {
  const before = collect();
  const document = detached ? detachedDocument() : scoreOrders;
  const engine = logEngine('lean');
  const outside = world();
  await engine.start((host) => startWorkflow(runFor(document, 'leak-check', runInput), host));
  for (let consumed = 0; consumed < size; consumed += 1) {
    const input = outside.next(engine);
    if (input === undefined) {
      break;
    }
    await engine.apply(input);
  }
  const retained = collect() - before;
  if (engine.settled() !== undefined) {
    throw new Error(`The run ended: ${JSON.stringify(engine.settled())}`);
  }
  return +(retained / mebibyte).toFixed(1);
}

const [variant = 'carried', sizeText = '10000'] = process.argv.slice(2);
const size = Number(sizeText);
console.log(JSON.stringify({ variant, size, retainedMiB: await retainedAfter(size, variant === 'detached') }));
