import { alternatives, listed, quoted } from '@on.auto/operations';
import { field, textField, type JsonObject, type TaskKind } from '@on.auto/workflow-engine';

import { runDefinitionFunction } from '../document/workflow-functions.ts';
import {
  durationText,
  expressionText,
  listenedOf,
  literalText,
  namedKeys,
  objectAt,
  runKindOf,
} from './task-reading.ts';

type Labeller = (task: JsonObject) => string;

function callLabel(task: JsonObject): string {
  const call = textField(task, 'call');
  if (call !== runDefinitionFunction) {
    return `Call ${String(call)}`;
  }
  const name = literalText(field(objectAt(task, 'with'), 'name'));
  return name === undefined ? 'Run a definition' : `Run ${name}`;
}

function setLabel(task: JsonObject): string {
  const keys = namedKeys(field(task, 'set'));
  return keys === undefined || keys.length === 0 ? 'Set its data' : `Set ${listed(keys)}`;
}

function listenLabel(task: JsonObject): string {
  const { mode, types } = listenedOf(task);
  const named = types.map((type) => type ?? 'an event sent to the run');
  return `Wait for ${mode === 'all' ? listed(named) : alternatives(named)}`;
}

function waitLabel(task: JsonObject): string {
  const duration = durationText(field(task, 'wait'));
  return duration === undefined ? 'Wait' : `Wait ${duration}`;
}

function emitLabel(task: JsonObject): string {
  const type = literalText(field(objectAt(task, 'emit', 'event', 'with'), 'type'));
  return type === undefined ? 'Publish an event' : `Publish ${type}`;
}

function raiseLabel(task: JsonObject): string {
  const error = field(objectAt(task, 'raise'), 'error');
  if (typeof error === 'string') {
    return `Raise ${error}`;
  }
  const title = textField(objectAt(task, 'raise', 'error'), 'title');
  return title === undefined ? 'Raise an error' : `Raise ${quoted(title)}`;
}

function runLabel(task: JsonObject): string {
  const kind = runKindOf(task);
  return kind === undefined ? 'Run a process' : `Run a ${kind}`;
}

function forLabel(task: JsonObject): string {
  const loop = objectAt(task, 'for');
  return `For each ${textField(loop, 'each') ?? 'item'} of ${expressionText(field(loop, 'in') ?? null)}`;
}

function forkLabel(task: JsonObject): string {
  return field(objectAt(task, 'fork'), 'compete') === true ? 'At once, the first to finish wins' : 'At once';
}

const labellers: Readonly<Record<TaskKind, Labeller>> = {
  for: forLabel,
  try: () => 'Try',
  call: callLabel,
  fork: forkLabel,
  emit: emitLabel,
  listen: listenLabel,
  raise: raiseLabel,
  run: runLabel,
  set: setLabel,
  switch: () => 'Choose a case',
  wait: waitLabel,
  do: () => 'In order',
};

export function labelOf(kind: TaskKind | undefined, task: JsonObject, name: string): string {
  return kind === undefined ? name : labellers[kind](task);
}
