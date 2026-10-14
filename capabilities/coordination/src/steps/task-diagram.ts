import { named, type Diagram, type Phrases } from '@on.auto/definitions';
import { field, textField, type Json, type JsonObject, type TaskKind } from '@on.auto/workflow-engine';

import { doWords, forkWords, forWords, movedWords, switchWords, tryWords, type StepPlace } from './flow-words.ts';
import { placedTasksOf, type PlacedTask } from './placed-tasks.ts';
import { edgesOf } from './task-edges.ts';
import { conditionOf } from './task-flow.ts';
import { durationText, objectAt } from './task-reading.ts';
import { callWords, emitWords, listenWords, raiseWords, runWords, setWords, waitWords } from './task-words.ts';

export interface TaskDiagram {
  readonly diagram: Diagram;
  readonly steps: readonly Phrases[];
}

type Describer = (task: PlacedTask, place: StepPlace) => Phrases;

const describers: Readonly<Record<TaskKind, Describer>> = {
  for: forWords,
  try: tryWords,
  call: ({ task }) => callWords(task),
  fork: forkWords,
  emit: ({ task }) => emitWords(task),
  listen: ({ task }) => listenWords(task),
  raise: ({ task }) => raiseWords(task),
  run: ({ task }) => runWords(task),
  set: ({ task }) => setWords(task),
  switch: switchWords,
  wait: ({ task }) => waitWords(task),
  do: doWords,
};

const unmoved: ReadonlySet<TaskKind | undefined> = new Set<TaskKind>(['switch', 'raise']);

function timeoutWords(task: JsonObject): Phrases {
  const timeout = field(task, 'timeout');
  if (timeout === undefined) {
    return [];
  }
  if (typeof timeout === 'string') {
    return [', within the timeout ', named(timeout)];
  }
  const duration = durationText(field(objectAt(task, 'timeout'), 'after'));
  return [duration === undefined ? ', within a time computed when it runs' : `, for at most ${duration}`];
}

function suffixWords(placed: PlacedTask, place: StepPlace): Phrases {
  const condition = conditionOf(placed.task);
  const moved = unmoved.has(placed.kind) ? undefined : movedWords(textField(placed.task, 'then'), place);
  return [
    ...(condition === undefined ? [] : [', only when ', { code: condition }, ' holds']),
    ...timeoutWords(placed.task),
    ...(moved === undefined ? [] : [`, and then ${moved}`]),
  ];
}

function itemOf(placed: PlacedTask, place: StepPlace): Phrases {
  const words =
    placed.kind === undefined ? ['is a step this runtime does not run'] : describers[placed.kind](placed, place);
  return [named(placed.name), ' ', ...words, ...suffixWords(placed, place), '.'];
}

function stepItems(tasks: readonly PlacedTask[], parent?: PlacedTask): readonly Phrases[] {
  return tasks.flatMap((task) => [
    itemOf(task, parent === undefined ? { siblings: tasks } : { siblings: tasks, parent }),
    ...stepItems(task.body, task),
    ...stepItems(task.recovery, task),
  ]);
}

export function taskDiagramOf(list: Json | undefined, entries: readonly string[]): TaskDiagram {
  const { tasks, nodes, groups } = placedTasksOf(list, entries.length);
  const starts = entries.map((label) => ({ label, shape: 'terminal' as const }));
  const edges = edgesOf(
    tasks,
    entries.map((_, from) => ({ from })),
  );
  return { diagram: { kind: 'diagram', nodes: [...starts, ...nodes], edges, groups }, steps: stepItems(tasks) };
}
