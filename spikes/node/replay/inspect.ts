import { startWorkflow } from '../../../primitives/orchestration/src/interpreter/interpreter.ts';
import { logEngine } from './log-host.ts';
import { scoreOrdersRun, world } from './workload.ts';

const size = Number(process.argv[2] ?? '300');
const engine = logEngine();
const outside = world();
await engine.start((host) => startWorkflow(scoreOrdersRun(), host));
for (let consumed = 0; consumed < size; consumed += 1) {
  const input = outside.next(engine);
  if (input === undefined) {
    break;
  }
  await engine.apply(input);
  const call = engine.waiting().find((entry) => entry.kind === 'call');
  if (call?.kind === 'call' && consumed >= size - 4) {
    console.log(JSON.stringify({ reference: call.call.reference, run: call.call.run, input: call.call.input }));
  }
}
console.log(JSON.stringify(engine.settled() ?? 'still running'));
