import { execFileSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import { measuredFiles, seriesMeasured, daysMeasured } from './measure/model-files.ts';
import { modelTimings } from './measure/model-timings.ts';

const mebibyte = 1_048_576;

const MemorySchema = Schema.fromJsonString(
  Schema.Struct({ before: Schema.Number, after: Schema.Number, peak: Schema.Number }),
);

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function ms(milliseconds: number): string {
  return `${milliseconds.toFixed(0)} ms`;
}

function mib(bytes: number): string {
  return `${(bytes / mebibyte).toFixed(0)} MiB`;
}

const files = measuredFiles();
try {
  write(`Node ${process.version}, ${cpus().length} cores`);
  const timed = await modelTimings(files);
  write(`a model process started cold, the model loaded and checked: ${ms(timed.coldCheckMs)}`);
  write(`a question on a process that has not loaded the model: ${ms(timed.coldRunMs)}`);
  write(`a question on the process that holds the model: ${ms(timed.warmRunMs)}`);
  write(
    `eight walks over ${seriesMeasured * daysMeasured} rows of ${seriesMeasured} series, 8 origins and 2 steps each: ${timed.walksMs.map((each) => ms(each)).join(', ')}`,
  );
  write(`the scores, the baseline and the bootstrap of one walk computed by the server: ${ms(timed.verdictMs)}`);
  write(`the shadow's walk of one version at one close over ${seriesMeasured} series: ${ms(timed.shadowWalkMs)}`);
  write(`the shadow's grade of one period over ${seriesMeasured} series: ${ms(timed.gradeMs)}`);
  execFileSync(process.execPath, [fileURLToPath(new URL('./measure/large-model.ts', import.meta.url)), files.large]);
  const largeBytes = statSync(files.large).size;
  const memory = Schema.decodeUnknownSync(MemorySchema)(
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./measure/session-memory.ts', import.meta.url)), files.large],
      {
        encoding: 'utf8',
      },
    ),
  );
  write(
    `a session of a ${mib(largeBytes)} model: ${mib(memory.before)} resident before it, ${mib(memory.after)} after it loaded and ran, ${mib(memory.peak)} at the peak`,
  );
} finally {
  rmSync(files.directory, { recursive: true, force: true });
}
