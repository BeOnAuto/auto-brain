import type { Variables } from '../dsl/expressions.ts';
import type { Json } from '../dsl/json.ts';
import type { TaskEntry } from '../dsl/tasks.ts';
import type { RunState } from './run-state.ts';

export interface Scope {
  readonly state: RunState;
  readonly variables: Variables;
}

export interface TaskOutcome {
  readonly output: Json;
  readonly flow: string;
}

type ListEnding = 'completed' | 'exited' | 'ended';

export interface ListResult {
  readonly output: Json;
  readonly ending: ListEnding;
}

export interface Body {
  readonly output: Json;
  readonly flow?: string;
}

export interface Runner {
  readonly runList: (list: Json | undefined, pointer: string, input: Json, scope: Scope) => Promise<ListResult>;
  readonly runTask: (entry: TaskEntry, input: Json, scope: Scope) => Promise<TaskOutcome>;
}

export interface Place {
  readonly reference: string;
  readonly now: number;
}

export interface Invocation {
  readonly entry: TaskEntry;
  readonly configuration: Json;
  readonly input: Json;
  readonly variables: Variables;
  readonly scope: Scope;
  readonly run: number;
  readonly runner: Runner;
}

export function bodyOf({ output, ending }: ListResult): Body {
  return ending === 'ended' ? { output, flow: 'end' } : { output };
}
