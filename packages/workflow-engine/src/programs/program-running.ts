import type { EvalOptions, Value } from '@gabrielbryk/jq-ts';

import { isJson, isList, isObject, measureOf, type Json, type JsonEntry } from '../dsl/json.ts';
import { issueOf, textOf, type ProgramIssue } from './program-tree.ts';

export type Variables = Readonly<Record<string, Json>>;

export interface Deadline {
  readonly milliseconds: number;
  readonly clock: () => number;
}

export interface ProgramLimits {
  readonly mostWork: number;
  readonly mostSteps: number;
  readonly mostDepth: number;
  readonly mostOutputs: number;
  readonly mostValueDepth: number;
}

export type Outputs = 'first' | 'exactly one';

export interface ProgramOptions {
  readonly limits: ProgramLimits;
  readonly outputs: Outputs;
  readonly variables?: Variables;
  readonly now?: number;
  readonly deadline?: Deadline;
}

export type Limit = 'work' | 'deadline' | 'value depth';

export type ProgramRun =
  | { readonly ran: 'answered'; readonly value: Json; readonly work: number }
  | { readonly ran: 'raised'; readonly issue: ProgramIssue; readonly work: number }
  | { readonly ran: 'exhausted'; readonly limit: Limit; readonly issue: ProgramIssue; readonly work: number }
  | { readonly ran: 'unanswered'; readonly outputs: number; readonly work: number }
  | { readonly ran: 'unfit'; readonly work: number };

const limitsByMessage: ReadonlyMap<string, Limit> = new Map<string, Limit>([
  ['Deadline exceeded', 'deadline'],
  ['Value depth limit exceeded', 'value depth'],
]);

const converted = new WeakMap<object, Value>();

export function toValue(json: Json): Value {
  if (!isList(json) && !isObject(json)) {
    return json;
  }
  const known = converted.get(json);
  if (known !== undefined) {
    return known;
  }
  const value: Value = isList(json)
    ? json.map((item) => toValue(item))
    : Object.fromEntries(Object.entries(json).map(([key, item]: JsonEntry) => [key, toValue(item)]));
  converted.set(json, value);
  return value;
}

function deadlineOf(deadline: Deadline | undefined): Pick<EvalOptions, 'deadline'> {
  return deadline === undefined
    ? {}
    : { deadline: { at: deadline.clock() + deadline.milliseconds, clock: deadline.clock } };
}

export function evalOptionsOf({ limits, outputs, variables = {}, now, deadline }: ProgramOptions): EvalOptions {
  return {
    vars: Object.fromEntries(Object.entries(variables).map(([name, value]: JsonEntry) => [name, toValue(value)])),
    limits: {
      maxWork: limits.mostWork,
      maxSteps: limits.mostSteps,
      maxDepth: limits.mostDepth,
      maxOutputs: limits.mostOutputs,
      maxValueDepth: limits.mostValueDepth,
    },
    ...(outputs === 'exactly one' ? { stopAfter: 2 } : {}),
    ...(now === undefined ? {} : { now: now / 1000 }),
    ...deadlineOf(deadline),
  };
}

export function failureOf(error: unknown, work: number): ProgramRun {
  const issue = issueOf(error);
  if (textOf(error, 'name') !== 'LimitError') {
    return { ran: 'raised', issue, work };
  }
  return { ran: 'exhausted', limit: limitsByMessage.get(issue.detail) ?? 'work', issue, work };
}

function answerOf(value: unknown, work: number, { limits }: ProgramOptions): ProgramRun {
  const measure = measureOf(value);
  if (measure !== undefined && measure.work > limits.mostWork) {
    return {
      ran: 'exhausted',
      limit: 'work',
      issue: { detail: 'Work limit exceeded', span: { start: 0, end: 0 } },
      work,
    };
  }
  return measure !== undefined && isJson(value) ? { ran: 'answered', value, work } : { ran: 'unfit', work };
}

export function outcomeOf(outputs: readonly unknown[], work: number, options: ProgramOptions): ProgramRun {
  if (options.outputs === 'exactly one' && outputs.length !== 1) {
    return { ran: 'unanswered', outputs: outputs.length, work };
  }
  const [first = null] = outputs;
  return answerOf(first, work, options);
}
