import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { meanModel } from '../candidates/candidate-graphs.ts';
import { elementTypes, model, tensor, valueInfo } from '../candidates/onnx-writer.ts';

const { float, int64 } = elementTypes;

export const seriesMeasured = 1000;

export const daysMeasured = 200;

export interface MeasuredFiles {
  readonly directory: string;
  readonly mean: string;
  readonly large: string;
  readonly rows: string;
}

export const largeModelFloats = 16_777_216;

export function largeModel(floats: number): Uint8Array {
  return Uint8Array.from(
    model({
      name: 'large_mean',
      nodes: [
        { op: 'ReduceSum', inputs: ['weights'], outputs: ['weighed'], attributes: [{ name: 'keepdims', int: 0 }] },
        { op: 'Mul', inputs: ['weighed', 'nothing'], outputs: ['zero'] },
        {
          op: 'ReduceMean',
          inputs: ['y'],
          outputs: ['mean'],
          attributes: [
            { name: 'axes', ints: [1] },
            { name: 'keepdims', int: 0 },
          ],
        },
        { op: 'Add', inputs: ['mean', 'zero'], outputs: ['level'] },
        { op: 'Reshape', inputs: ['level', 'level_cube'], outputs: ['level_point'] },
        { op: 'Expand', inputs: ['level_point', 'level_steps'], outputs: ['mid'] },
        { op: 'Sub', inputs: ['mid', 'below'], outputs: ['low'] },
        { op: 'Add', inputs: ['mid', 'above'], outputs: ['high'] },
        { op: 'Concat', inputs: ['low', 'mid', 'high'], outputs: ['q'], attributes: [{ name: 'axis', int: 2 }] },
      ],
      initializers: [
        tensor(
          'weights',
          float,
          [floats],
          Array.from({ length: floats }, () => 1),
        ),
        tensor('nothing', float, [], [0]),
        tensor('level_cube', int64, [3], [1, 1, 1]),
        tensor('level_steps', int64, [3], [1, 2, 1]),
        tensor('below', float, [], [2]),
        tensor('above', float, [], [2]),
      ],
      inputs: [valueInfo('y', float, [1, 'L'])],
      outputs: [valueInfo('q', float, [1, 2, 3])],
    }),
  );
}

function rowsText(): string {
  const records = ['series,period,visits'];
  const first = Date.UTC(2026, 2, 1);
  for (let series = 0; series < seriesMeasured; series += 1) {
    const name = `store-${String(series).padStart(4, '0')}`;
    for (let day = 0; day < daysMeasured; day += 1) {
      records.push(
        `${name},${new Date(first + day * 86_400_000).toISOString().slice(0, 10)},${10 + ((day + series) % 7)}`,
      );
    }
  }
  return `${records.join('\r\n')}\r\n`;
}

export function measuredFiles(): MeasuredFiles {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-prediction-models-'));
  const files = {
    mean: join(directory, 'mean.onnx'),
    large: join(directory, 'large.onnx'),
    rows: join(directory, 'scoring.csv'),
  };
  writeFileSync(files.mean, meanModel({ steps: 2, low: 2, high: 2 }));
  writeFileSync(files.rows, rowsText());
  return { directory, ...files };
}
