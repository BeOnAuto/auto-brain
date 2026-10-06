import {
  field,
  forbidden,
  isObject,
  type Json,
  type JsonObject,
  literalFilterOf,
  type LiteralFilter,
  pointerTo,
  readDuration,
  type Rejection,
  rejection,
} from '@beonauto/workflow-engine';
import { cronRejectionOf, type Trigger } from '@beonauto/workflow-host';

type Kind = 'on' | 'cron' | 'every';

const kinds: readonly Kind[] = ['on', 'cron', 'every'];

const shortestPeriodMs = 60_000;

const oneKind = 'A workflow has one trigger: its schedule names one of on, cron and every';

const afterRefused =
  'A workflow is not started again after its run ends: give it a trigger with on, cron or every instead';

const allRefused =
  'A trigger starts a run for every event that matches it, so it takes one or any; all, which waits for several events, is for a listen task';

const untilRefused = 'A trigger matches every event of its brain while its version is active, so it takes no until';

const onTakes = 'on takes one, a filter of the events that start the workflow, or any, a list of at least one';

const variablesRefused =
  'A trigger is matched before any run starts, so its data expression cannot use variables such as $workflow';

function isKind(key: string): key is Kind {
  return kinds.some((kind) => kind === key);
}

function filterRejections(filter: Json, pointer: string): readonly Rejection[] {
  const reading = literalFilterOf(filter, pointer);
  if ('rejections' in reading) {
    return reading.rejections;
  }
  return reading.filter.dataNeedsVariables ? [forbidden(`${pointer}/with/data`, variablesRefused)] : [];
}

function filtersOf(on: JsonObject): readonly (readonly [Json, string])[] {
  const one = field(on, 'one');
  const any = field(on, 'any');
  if (one !== undefined) {
    return [[one, '/one']];
  }
  return Array.isArray(any) ? any.map((filter, index): readonly [Json, string] => [filter, `/any/${index}`]) : [];
}

function onRejections(on: Json, pointer: string): readonly Rejection[] {
  if (!isObject(on)) {
    return [rejection(pointer, onTakes)];
  }
  if (field(on, 'all') !== undefined) {
    return [forbidden(`${pointer}/all`, allRefused)];
  }
  const until = field(on, 'until') === undefined ? [] : [forbidden(`${pointer}/until`, untilRefused)];
  const filters = filtersOf(on);
  const empty = filters.length === 0 ? [rejection(pointer, onTakes)] : [];
  return until.concat(
    empty,
    filters.flatMap(([filter, place]) => filterRejections(filter, `${pointer}${place}`)),
  );
}

function cronRejections(cron: Json, pointer: string): readonly Rejection[] {
  if (typeof cron !== 'string') {
    return [rejection(pointer, 'cron is text of five fields, minute, hour, day of month, month and day of week')];
  }
  const refusal = cronRejectionOf(cron);
  return refusal === undefined ? [] : [rejection(pointer, refusal)];
}

function everyRejections(every: Json, pointer: string): readonly Rejection[] {
  const reading = readDuration(every);
  if ('problem' in reading) {
    return [rejection(pointer, reading.problem)];
  }
  return reading.milliseconds < shortestPeriodMs
    ? [rejection(pointer, `A schedule is due at most once a minute, not every ${reading.milliseconds} ms`)]
    : [];
}

const kindRejections: Readonly<Record<Kind, (value: Json, pointer: string) => readonly Rejection[]>> = {
  on: onRejections,
  cron: cronRejections,
  every: everyRejections,
};

function isKindEntry(entry: readonly [string, Json]): entry is readonly [Kind, Json] {
  return isKind(entry[0]);
}

export function scheduleRejections(schedule: Json, pointer: string): readonly Rejection[] {
  if (!isObject(schedule)) {
    return [rejection(pointer, 'schedule is a mapping that names the trigger of the workflow: on, cron or every')];
  }
  const entries: readonly (readonly [string, Json])[] = Object.entries(schedule);
  const named = entries.filter((entry: readonly [string, Json]) => isKindEntry(entry));
  const after = field(schedule, 'after') === undefined ? [] : [forbidden(`${pointer}/after`, afterRefused)];
  const unknown = entries
    .filter(([key]: readonly [string, Json]) => !isKind(key) && key !== 'after')
    .map(([key]: readonly [string, Json]) =>
      rejection(pointerTo(pointer, key), `schedule takes on, cron or every, not ${key}`),
    );
  const count = named.length === 1 || (named.length === 0 && after.length > 0) ? [] : [rejection(pointer, oneKind)];
  return after.concat(
    unknown,
    count,
    named.flatMap(([kind, value]: readonly [Kind, Json]) => kindRejections[kind](value, pointerTo(pointer, kind))),
  );
}

function eventTriggerOf(on: JsonObject): Trigger {
  const filters = filtersOf(on).flatMap(([filter, place]): readonly LiteralFilter[] => {
    const reading = literalFilterOf(filter, `/schedule/on${place}`);
    return 'filter' in reading ? [reading.filter] : [];
  });
  return { kind: 'events', filters };
}

export function triggerOfDocument(document: JsonObject): Trigger | undefined {
  const schedule = field(document, 'schedule');
  if (!isObject(schedule)) {
    return undefined;
  }
  const on = field(schedule, 'on');
  const cron = field(schedule, 'cron');
  const every = readDuration(field(schedule, 'every') ?? null);
  if (isObject(on)) {
    return eventTriggerOf(on);
  }
  if (typeof cron === 'string') {
    return { kind: 'cron', expression: cron };
  }
  return 'milliseconds' in every ? { kind: 'every', milliseconds: every.milliseconds } : undefined;
}
