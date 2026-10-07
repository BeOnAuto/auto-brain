import { decideMeasured, snapshotMeasured } from './measure/decide.ts';
import { engineMeasured } from './measure/engine.ts';
import { loopMeasured } from './measure/loop.ts';
import { pagesMeasured } from './measure/pages.ts';

const measured = [
  `Node ${process.version}`,
  ...loopMeasured(40_000),
  ...engineMeasured(10_000),
  ...decideMeasured(),
  ...snapshotMeasured(),
  ...(await pagesMeasured()),
];

for (const line of measured) {
  process.stdout.write(`${line}\n`);
}
