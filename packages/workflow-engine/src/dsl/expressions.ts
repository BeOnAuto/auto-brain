import { parse, runAst, validate, type EvalOptions, type Value } from '@gabrielbryk/jq-ts';

import { boundedCacheOf } from './bounded-cache.ts';
import { isJson, isList, isObject, measureOf, mostValueDepth, type Json, type JsonEntry } from './json.ts';

export type Variables = Readonly<Record<string, Json>>;

export interface Deadline {
  readonly milliseconds: number;
  readonly clock: () => number;
}

export interface Budget {
  readonly now: number;
  readonly mostWork: number;
  readonly deadline?: Deadline;
}

export type Limit = 'work' | 'deadline';

export type Evaluation =
  | { readonly value: Json; readonly work: number }
  | { readonly problem: string; readonly work: number; readonly exhausted: false }
  | { readonly problem: string; readonly work: number; readonly exhausted: true; readonly limit: Limit };

type Compiled = { readonly program: ReturnType<typeof parse> } | { readonly problem: string };

const hostDependentBuiltins: ReadonlySet<string> = new Set(['localtime', 'strflocaltime']);

const scopesOfBindings: ReadonlyMap<unknown, readonly string[]> = new Map([
  ['As', ['body']],
  ['Reduce', ['update']],
  ['Foreach', ['update', 'extract']],
]);

const enclosedExpression = /^\s*\$\{(?<body>[\s\S]*)\}\s*$/u;

const limits = { maxSteps: 200_000, maxDepth: 200, maxOutputs: 10_000 };

const longestProblem = 1000;

const deadlineExceeded = 'Deadline exceeded';

export const mostCompiledCharacters = 262_144;

const compiled = boundedCacheOf<Compiled>(mostCompiledCharacters);

const converted = new WeakMap<object, Value>();

export function enclosedBody(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? enclosedExpression.exec(value)?.groups?.['body'] : undefined;
}

export function expressionSource(text: string): string {
  return enclosedBody(text) ?? text;
}

export function checkExpression(source: string): string | undefined {
  const program = compile(source);
  return 'problem' in program ? program.problem : undefined;
}

export function freeVariablesOf(source: string): readonly string[] {
  const program = compile(source);
  return 'problem' in program ? [] : [...new Set(variablesReadIn(program.program, new Set()))];
}

export function runExpression(source: string, data: Json, variables: Variables, budget: Budget): Evaluation {
  const program = compile(source);
  if ('problem' in program) {
    return { problem: program.problem, work: 0, exhausted: false };
  }
  const usage = { work: 0 };
  try {
    const [first = null] = runAst(program.program, toValue(data), {
      vars: Object.fromEntries(Object.entries(variables).map(([name, value]: JsonEntry) => [name, toValue(value)])),
      now: budget.now / 1000,
      limits: { ...limits, maxWork: budget.mostWork },
      usage,
      ...deadlineOf(budget.deadline),
    });
    return resultOf(source, first, usage.work, budget.mostWork);
  } catch (error) {
    return failureOf(shortened(`${source}: ${String(error)}`), usage.work, error);
  }
}

function deadlineOf(deadline: Deadline | undefined): Pick<EvalOptions, 'deadline'> {
  return deadline === undefined
    ? {}
    : { deadline: { at: deadline.clock() + deadline.milliseconds, clock: deadline.clock } };
}

function failureOf(problem: string, work: number, error: unknown): Evaluation {
  if (!(error instanceof Error) || error.name !== 'LimitError') {
    return { problem, work, exhausted: false };
  }
  return { problem, work, exhausted: true, limit: error.message === deadlineExceeded ? 'deadline' : 'work' };
}

function resultOf(source: string, value: unknown, work: number, mostWork: number): Evaluation {
  const measure = measureOf(value);
  if (work > mostWork || (measure !== undefined && measure.work > mostWork)) {
    return { problem: shortened(`${source}: Work limit exceeded`), work, exhausted: true, limit: 'work' };
  }
  return measure !== undefined && isJson(value)
    ? { value, work }
    : {
        problem: shortened(`${source} gave a value that is not JSON or nests more than ${mostValueDepth} levels deep`),
        work,
        exhausted: false,
      };
}

function shortened(problem: string): string {
  return problem.length > longestProblem ? `${problem.slice(0, longestProblem)}…` : problem;
}

function compile(source: string): Compiled {
  const known = compiled.get(source);
  if (known !== undefined) {
    return known;
  }
  const fresh = freshlyCompiled(source);
  compiled.set(source, fresh);
  return fresh;
}

function freshlyCompiled(source: string): Compiled {
  try {
    const program = parse(source);
    validate(program);
    const hostDependent = namesOfKindIn(program, 'Call').find((name) => hostDependentBuiltins.has(name));
    return hostDependent === undefined
      ? { program }
      : {
          problem: `${source}: ${hostDependent} reads the host's time zone, so it is not deterministic; use the UTC builtins`,
        };
  } catch (error) {
    return { problem: shortened(`${source}: ${String(error)}`) };
  }
}

function namesOfKindIn(node: unknown, kind: string): readonly string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: unknown) => namesOfKindIn(child, kind));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const own: unknown = Reflect.get(node, 'kind') === kind ? Reflect.get(node, 'name') : undefined;
  const nested = Object.values(node).flatMap((child: unknown) => namesOfKindIn(child, kind));
  return typeof own === 'string' ? [own, ...nested] : nested;
}

function variablesReadIn(node: unknown, bound: ReadonlySet<string>): readonly string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: unknown) => variablesReadIn(child, bound));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const kind: unknown = Reflect.get(node, 'kind');
  const name: unknown = Reflect.get(node, 'name');
  if (kind === 'Var' && typeof name === 'string') {
    return bound.has(name) ? [] : [name];
  }
  const scoped = scopesOfBindings.get(kind) ?? [];
  const inner = new Set([...bound, ...namesOfKindIn(Reflect.get(node, 'pattern'), 'VariablePattern')]);
  return Object.entries(node).flatMap(([key, child]: readonly [string, unknown]) =>
    variablesReadIn(child, scoped.includes(key) ? inner : bound),
  );
}

function toValue(json: Json): Value {
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
