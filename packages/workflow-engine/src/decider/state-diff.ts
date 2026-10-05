import type { Json, JsonObject } from '../dsl/json.ts';
import { pointerTo } from '../dsl/tasks.ts';
import type { PatchOperation } from '../run-log/state-patch.ts';

type Fields = object;

function fieldOf(fields: Fields, key: string): unknown {
  const item: unknown = Reflect.get(fields, key);
  return item;
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectOf(fields: Fields): JsonObject {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, item]: readonly [string, unknown]) => item !== undefined)
      .map(([key, item]: readonly [string, unknown]) => [key, jsonOf(item)]),
  );
}

export function jsonOf(value: unknown): Json {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => jsonOf(item));
  }
  return isFields(value) ? objectOf(value) : null;
}

function diffFields(before: Fields, after: Fields, path: string): readonly PatchOperation[] {
  const removed = Object.keys(before)
    .filter((key) => !Object.hasOwn(after, key))
    .map((key): PatchOperation => ({ op: 'remove', path: pointerTo(path, key) }));
  const changed = Object.entries(after).flatMap(([key, item]: readonly [string, unknown]): readonly PatchOperation[] =>
    Object.hasOwn(before, key)
      ? diffInto(fieldOf(before, key), item, pointerTo(path, key))
      : [{ op: 'add', path: pointerTo(path, key), value: jsonOf(item) }],
  );
  return [...removed, ...changed];
}

function diffInto(before: unknown, after: unknown, path: string): readonly PatchOperation[] {
  if (before === after) {
    return [];
  }
  if (isFields(before) && isFields(after)) {
    return diffFields(before, after, path);
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return after.flatMap((item: unknown, index) => diffInto(before[index], item, pointerTo(path, index)));
  }
  return [{ op: 'replace', path, value: jsonOf(after) }];
}

export function patchBetween(before: Fields, after: Fields): readonly PatchOperation[] {
  return diffFields(before, after, '');
}
