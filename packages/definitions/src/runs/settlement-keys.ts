import { createHash } from 'node:crypto';

import type { Schema } from 'effect';

import type { RunResult } from './run-commands.ts';

function canonical(value: Schema.Json): Schema.Json {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: Schema.Json) => canonical(item));
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([first]: readonly [string, Schema.Json], [second]: readonly [string, Schema.Json]) =>
        first < second ? -1 : 1,
      )
      .map(([key, item]: readonly [string, Schema.Json]) => [key, canonical(item)]),
  );
}

function digestOf(value: Schema.Json): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)), 'utf8')
    .digest('hex');
}

export function succeedsWith(result: RunResult, output: Schema.Json): boolean {
  return result.type === 'run_succeeded' && digestOf(result.output) === digestOf(output);
}

export function settlementKeyOf(result: RunResult): string {
  if (result.type === 'run_succeeded') {
    return JSON.stringify([result.type, digestOf(result.output)]);
  }
  if (result.type === 'run_rejected') {
    const { rejection } = result;
    const kind = 'kind' in rejection ? rejection.kind : undefined;
    return JSON.stringify([result.type, rejection.reason, kind ?? null]);
  }
  return JSON.stringify([result.type]);
}
