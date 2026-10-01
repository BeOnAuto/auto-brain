import { entriesOf, field, isList, isObject, type Json, type JsonObject } from './json.ts';

export const taskKinds = [
  'for',
  'try',
  'call',
  'fork',
  'emit',
  'listen',
  'raise',
  'run',
  'set',
  'switch',
  'wait',
  'do',
] as const;

export type TaskKind = (typeof taskKinds)[number];

export interface TaskEntry {
  readonly name: string;
  readonly task: JsonObject;
  readonly reference: string;
}

export interface TaskType {
  readonly kind: TaskKind;
  readonly configuration: Json;
}

export function kindOf(task: JsonObject): TaskKind | undefined {
  return typeOf(task)?.kind;
}

export function typeOf(task: JsonObject): TaskType | undefined {
  for (const kind of taskKinds) {
    const configuration = field(task, kind);
    if (configuration !== undefined) {
      return { kind, configuration };
    }
  }
  return undefined;
}

export function pointerTo(parent: string, key: string | number): string {
  return `${parent}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

export function taskEntries(list: Json | undefined, pointer: string): readonly TaskEntry[] {
  if (!isList(list)) {
    return [];
  }
  return list.flatMap((item, index) =>
    isObject(item)
      ? entriesOf(item).flatMap(([name, task]) =>
          isObject(task) ? [{ name, task, reference: pointerTo(pointerTo(pointer, index), name) }] : [],
        )
      : [],
  );
}
