import { decideMeasured, snapshotMeasured } from './measure/decide.ts';
import { engineMeasured } from './measure/engine.ts';
import { loopMeasured } from './measure/loop.ts';

const measured = [
  `Node ${process.version}`,
  ...loopMeasured(40_000),
  ...engineMeasured(10_000),
  ...decideMeasured(),
  ...snapshotMeasured(),
];

for (const line of measured) {
  process.stdout.write(`${line}\n`);
}
