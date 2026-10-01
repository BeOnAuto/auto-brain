import type { TaskKind } from '../dsl/tasks.ts';
import { callTask } from './call-task.ts';
import { raiseTask, tryTask } from './error-tasks.ts';
import { doTask, forkTask, forTask, switchTask } from './flow-tasks.ts';
import type { Body, Invocation } from './invocation.ts';
import { listenTask } from './listen-task.ts';
import { raised } from './raised-error.ts';
import { setTask, waitTask } from './simple-tasks.ts';

export type TaskBody = (invocation: Invocation) => Body | Promise<Body>;

const refusedTask: TaskBody = ({ entry }) => {
  throw raised('configuration', 400, 'emit and run tasks are not allowed by this runtime', entry.reference);
};

const bodies: Readonly<Record<TaskKind, TaskBody>> = {
  call: callTask,
  do: doTask,
  emit: refusedTask,
  for: forTask,
  fork: forkTask,
  listen: listenTask,
  raise: raiseTask,
  run: refusedTask,
  set: setTask,
  switch: switchTask,
  try: tryTask,
  wait: waitTask,
};

export function bodyFor(kind: TaskKind): TaskBody {
  return bodies[kind];
}
