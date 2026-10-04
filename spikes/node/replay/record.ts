import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { startWorkflow } from '../../../primitives/orchestration/src/interpreter/interpreter.ts';
import { logEngine, type Input } from './log-host.ts';
import { scoreOrdersRun, world } from './workload.ts';

export interface RecordedLog {
  readonly inputs: readonly Input[];
  readonly commands: number;
  readonly digest: string;
  readonly endedEarly: boolean;
}

export const dataDirectory = join(import.meta.dirname, '..', '.data');

export function logFileOf(size: number): string {
  return join(dataDirectory, `replay-log-${size}.json`);
}

export async function record(size: number): Promise<RecordedLog> {
  const engine = logEngine();
  const outside = world();
  const inputs: Input[] = [];
  await engine.start((host) => startWorkflow(scoreOrdersRun(), host));
  while (inputs.length < size && engine.settled() === undefined) {
    const input = outside.next(engine);
    if (input === undefined) {
      break;
    }
    inputs.push(input);
    await engine.apply(input);
  }
  const settled = engine.settled();
  if (settled !== undefined) {
    console.error(`The run ended after ${inputs.length} inputs: ${JSON.stringify(settled.settlement)}`);
  }
  return { inputs, commands: engine.commands(), digest: engine.digest(), endedEarly: inputs.length < size };
}

if (import.meta.main) {
  const size = Number(process.argv[2] ?? '1000');
  const log = await record(size);
  mkdirSync(dataDirectory, { recursive: true });
  const text = JSON.stringify(log);
  writeFileSync(logFileOf(size), text);
  const kinds = Object.groupBy(log.inputs, ({ k }) => k);
  console.log(
    JSON.stringify({
      size,
      inputs: log.inputs.length,
      timers: kinds.timer?.length ?? 0,
      results: kinds.result?.length ?? 0,
      events: kinds.event?.length ?? 0,
      commands: log.commands,
      digest: log.digest,
      endedEarly: log.endedEarly,
      logBytes: Buffer.byteLength(text),
      virtualDays: ((log.inputs.at(-1)?.at ?? 0) - (log.inputs[0]?.at ?? 0)) / 86_400_000,
    }),
  );
}
