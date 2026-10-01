import { entriesOf, field, isList, isObject, mostValueDepth, objectField, type Json, type JsonObject } from './json.ts';
import { forbidden, type Located, type Rejection } from './policy-checks.ts';
import { kindOf, pointerTo, taskEntries, type TaskEntry } from './tasks.ts';

export const mostTaskNesting = 64;

export function nestingRejections(document: JsonObject): readonly Rejection[] {
  const deepValue = deepValueIn(document, '', mostValueDepth);
  if (deepValue !== undefined) {
    return [forbidden(deepValue, `The document nests values more than ${mostValueDepth} levels deep`)];
  }
  const deepList = deepTaskListIn(field(document, 'do'), '/do', mostTaskNesting);
  return deepList === undefined
    ? []
    : [forbidden(deepList, `The document nests tasks more than ${mostTaskNesting} levels deep`)];
}

function deepValueIn(value: Json, pointer: string, room: number): string | undefined {
  if (!isList(value) && !isObject(value)) {
    return undefined;
  }
  if (room === 0) {
    return pointer;
  }
  const children: readonly Located[] = isList(value)
    ? value.map((item, index): Located => [item, pointerTo(pointer, index)])
    : entriesOf(value).map(([key, item]): Located => [item, pointerTo(pointer, key)]);
  return firstFound(children, ([child, at]) => deepValueIn(child ?? null, at, room - 1));
}

function deepTaskListIn(list: Json | undefined, pointer: string, room: number): string | undefined {
  if (!isList(list)) {
    return undefined;
  }
  return room === 0 ? pointer : firstFound(taskEntries(list, pointer), (entry) => deepTaskListUnder(entry, room - 1));
}

function deepTaskListUnder({ task, reference }: TaskEntry, room: number): string | undefined {
  const kind = kindOf(task);
  const lists: readonly Located[] = [
    [kind === 'do' || kind === 'for' ? field(task, 'do') : undefined, `${reference}/do`],
    [kind === 'try' ? field(task, 'try') : undefined, `${reference}/try`],
    [kind === 'try' ? field(objectField(task, 'catch') ?? {}, 'do') : undefined, `${reference}/catch/do`],
    [kind === 'fork' ? field(objectField(task, 'fork') ?? {}, 'branches') : undefined, `${reference}/fork/branches`],
  ];
  return firstFound(lists, ([list, at]) => deepTaskListIn(list, at, room));
}

function firstFound<T>(items: readonly T[], find: (item: T) => string | undefined): string | undefined {
  for (const item of items) {
    const found = find(item);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
