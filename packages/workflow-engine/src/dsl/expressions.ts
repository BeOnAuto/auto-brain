import { compileProgram, type CompiledProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { Deadline, Limit, ProgramLimits, ProgramRun, Variables } from '../programs/program-running.ts';
import type { ProgramIssue } from '../programs/program-tree.ts';
import { boundedCacheOf } from './bounded-cache.ts';
import { mostValueDepth, type Json } from './json.ts';

export interface Budget {
  readonly now: number;
  readonly mostWork: number;
  readonly deadline?: Deadline;
}

export type Evaluation =
  | { readonly value: Json; readonly work: number }
  | { readonly problem: string; readonly work: number; readonly exhausted: false }
  | { readonly problem: string; readonly work: number; readonly exhausted: true; readonly limit: Limit };

const hostTimeZone = "reads the host's time zone, so it is not deterministic; use the UTC builtins";

const workflowDialect: Dialect = {
  refused: [
    { name: 'localtime', why: hostTimeZone },
    { name: 'strflocaltime', why: hostTimeZone },
  ],
};

const workflowLimits: Omit<ProgramLimits, 'mostWork'> = {
  mostSteps: 200_000,
  mostDepth: 200,
  mostOutputs: 10_000,
  mostValueDepth: Number.POSITIVE_INFINITY,
};

const enclosedExpression = /^\s*\$\{(?<body>[\s\S]*)\}\s*$/u;

const longestProblem = 1000;

export const mostCompiledCharacters = 262_144;

const compiled = boundedCacheOf<CompiledProgram>(mostCompiledCharacters);

export function enclosedBody(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? enclosedExpression.exec(value)?.groups?.['body'] : undefined;
}

export function expressionSource(text: string): string {
  return enclosedBody(text) ?? text;
}

function shortened(problem: string): string {
  return problem.length > longestProblem ? `${problem.slice(0, longestProblem)}…` : problem;
}

function problemOf(source: string, { error, detail }: ProgramIssue): string {
  return shortened(`${source}: ${error === undefined ? '' : `${error}: `}${detail}`);
}

function compile(source: string): CompiledProgram {
  const known = compiled.get(source);
  if (known !== undefined) {
    return known;
  }
  const fresh = compileProgram(source, workflowDialect);
  compiled.set(source, fresh);
  return fresh;
}

export function checkExpression(source: string): string | undefined {
  const program = compile(source);
  const [issue] = 'issues' in program ? program.issues : [];
  return issue === undefined ? undefined : problemOf(source, issue);
}

export function freeVariablesOf(source: string): readonly string[] {
  const program = compile(source);
  return 'issues' in program ? [] : program.program.freeVariables;
}

function evaluationOf(source: string, run: ProgramRun): Evaluation {
  if (run.ran === 'answered') {
    return { value: run.value, work: run.work };
  }
  if (run.ran === 'exhausted' && run.limit !== 'stack') {
    return { problem: problemOf(source, run.issue), work: run.work, exhausted: true, limit: run.limit };
  }
  if (run.ran === 'raised' || run.ran === 'exhausted') {
    return { problem: problemOf(source, run.issue), work: run.work, exhausted: false };
  }
  return {
    problem: shortened(`${source} gave a value that is not JSON or nests more than ${mostValueDepth} levels deep`),
    work: run.work,
    exhausted: false,
  };
}

export function runExpression(source: string, data: Json, variables: Variables, budget: Budget): Evaluation {
  const program = compile(source);
  if ('issues' in program) {
    return { problem: problemOf(source, program.issues[0]), work: 0, exhausted: false };
  }
  const run = program.program.run(data, {
    limits: { ...workflowLimits, mostWork: budget.mostWork },
    outputs: 'first',
    variables,
    now: budget.now,
    ...(budget.deadline === undefined ? {} : { deadline: budget.deadline }),
  });
  return evaluationOf(source, run);
}
