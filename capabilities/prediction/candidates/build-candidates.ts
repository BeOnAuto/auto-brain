import { writeFileSync } from 'node:fs';

import {
  allocatingModel,
  extraInputModel,
  hostileModel,
  lastValueModel,
  meanModel,
  notANumberModel,
  observedMeanModel,
  runRateModel,
  sequenceModel,
  wholeNumbersModel,
} from './candidate-graphs.ts';
import type { Bytes } from './onnx-writer.ts';

const visits = { steps: 2, low: 1, high: 1 };

const candidates: Readonly<Record<string, Bytes>> = {
  'visits-last': lastValueModel(visits),
  'visits-wide': lastValueModel({ ...visits, low: 100, high: 100 }),
  'visits-narrow': lastValueModel({ ...visits, low: 0, high: 0 }),
  'visits-even': lastValueModel({ ...visits, low: 3, high: 3 }),
  'visits-mean': meanModel({ ...visits, low: 2, high: 2 }),
  'visits-observed-mean': observedMeanModel({ ...visits, low: 2, high: 2 }),
  'visits-week': lastValueModel(visits, { length: 7 }),
  'visits-many-features': meanModel({ ...visits, low: 2, high: 2 }, { features: 40, given: 8 }),
  'visits-steady': meanModel({ ...visits, low: 5, high: 5 }),
  'visits-not-a-number': notANumberModel(2),
  'visits-extra-input': extraInputModel(visits),
  'visits-opset-12': lastValueModel(visits, {}, 12),
  'visits-whole-numbers': wholeNumbersModel(2),
  'visits-allocating': allocatingModel(2),
  'visits-hostile': hostileModel(2),
  'visits-sequence': sequenceModel(2),
  'orders-last': lastValueModel({ steps: 4, low: 2, high: 2 }, { features: 2, given: 1 }),
  'totals-run-rate': runRateModel(),
};

const here = new URL('./', import.meta.url);

for (const [name, bytes] of Object.entries(candidates)) {
  writeFileSync(new URL(`${name}.onnx`, here), bytes);
}
writeFileSync(new URL('not-a-model.onnx', here), 'This is text that says it is a model, and it is not one.\n');
process.stdout.write(`Wrote ${Object.keys(candidates).length + 1} candidate files into ${here.pathname}\n`);
