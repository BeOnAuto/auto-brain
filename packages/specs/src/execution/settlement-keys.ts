import { createHash } from 'node:crypto';

import type { Schema } from 'effect';

import type { ExecutionResult } from './execution-commands.ts';

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

export function settlementKeyOf(result: ExecutionResult): string {
  if (result.type === 'execution_succeeded') {
    return JSON.stringify([result.type, digestOf(result.output)]);
  }
  if (result.type === 'execution_rejected') {
    const { rejection } = result;
    const kind = 'kind' in rejection ? rejection.kind : undefined;
    return JSON.stringify([result.type, rejection.reason, kind ?? null]);
  }
  return JSON.stringify([result.type]);
}
