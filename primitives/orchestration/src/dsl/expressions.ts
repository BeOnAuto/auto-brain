import { parse, runAst, validate, type Value } from '@gabrielbryk/jq-ts';

import { isJson, isList, isObject, type Json, type JsonEntry } from './json.ts';

export type Variables = Readonly<Record<string, Json>>;

export type Evaluation = { readonly value: Json } | { readonly problem: string };

type Compiled = { readonly program: ReturnType<typeof parse> } | { readonly problem: string };

const hostDependentBuiltins: ReadonlySet<string> = new Set(['localtime', 'strflocaltime']);

const enclosedExpression = /^\s*\$\{(?<body>[\s\S]*)\}\s*$/u;

const limits = { maxSteps: 200_000, maxDepth: 200, maxOutputs: 10_000 };

const compiled = new Map<string, Compiled>();

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

export function runExpression(source: string, data: Json, variables: Variables, now: number): Evaluation {
  const program = compile(source);
  if ('problem' in program) {
    return program;
  }
  try {
    const [first = null] = runAst(program.program, toValue(data), {
      vars: Object.fromEntries(Object.entries(variables).map(([name, value]: JsonEntry) => [name, toValue(value)])),
      now: now / 1000,
      limits,
    });
    return isJson(first) ? { value: first } : { problem: `${source} gave a value that is not JSON` };
  } catch (error) {
    return { problem: `${source}: ${String(error)}` };
  }
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
    const hostDependent = callsIn(program).find((name) => hostDependentBuiltins.has(name));
    return hostDependent === undefined
      ? { program }
      : {
          problem: `${source}: ${hostDependent} reads the host's time zone, so it is not deterministic; use the UTC builtins`,
        };
  } catch (error) {
    return { problem: `${source}: ${String(error)}` };
  }
}

function callsIn(node: unknown): readonly string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: unknown) => callsIn(child));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const own: unknown = Reflect.get(node, 'kind') === 'Call' ? Reflect.get(node, 'name') : undefined;
  const nested = Object.values(node).flatMap((child: unknown) => callsIn(child));
  return typeof own === 'string' ? [own, ...nested] : nested;
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
