import { isJson } from '../dsl/json.ts';
import { jsonBytesWithin, mostIssueBytes, textWithin } from '../programs/byte-sizes.ts';
import { compileProgram } from '../programs/program-compiling.ts';
import type { Dialect, Refusal } from '../programs/program-dialect.ts';
import type { ProgramLimits, ProgramRun } from '../programs/program-running.ts';
import { fieldOf, listOf, textOf, type ProgramIssue } from '../programs/program-tree.ts';
import type { ProgramAnswerSchema } from './program-messages.ts';

type ProgramAnswerData = typeof ProgramAnswerSchema.Encoded;

interface ProgramRequestData {
  readonly source: string;
  readonly input: string;
  readonly dialect: Dialect;
  readonly limits: ProgramLimits;
  readonly deadlineAt: number;
  readonly mostOutputBytes: number;
}

const tooDeep: ProgramAnswerData = {
  ran: 'exhausted',
  limit: 'value depth',
  issue: { detail: 'The input nests too deep', span: { start: 0, end: 0 } },
  work: 0,
};

function numberOf(data: unknown, name: string): number {
  const value = fieldOf(data, name);
  return typeof value === 'number' ? value : 0;
}

function dialectOf(data: unknown): Dialect {
  const refused = listOf(data, 'refused').map((refusal): Refusal => ({
    name: textOf(refusal, 'name'),
    why: textOf(refusal, 'why'),
  }));
  const variables = fieldOf(data, 'variables');
  return Array.isArray(variables) ? { refused, variables: variables.map(String) } : { refused };
}

function limitsOf(data: unknown): ProgramLimits {
  return {
    mostWork: numberOf(data, 'mostWork'),
    mostSteps: numberOf(data, 'mostSteps'),
    mostDepth: numberOf(data, 'mostDepth'),
    mostOutputs: numberOf(data, 'mostOutputs'),
    mostValueDepth: numberOf(data, 'mostValueDepth'),
  };
}

function requestOf(data: unknown): ProgramRequestData {
  return {
    source: textOf(data, 'source'),
    input: textOf(data, 'input'),
    dialect: dialectOf(fieldOf(data, 'dialect')),
    limits: limitsOf(fieldOf(data, 'limits')),
    deadlineAt: numberOf(data, 'deadlineAt'),
    mostOutputBytes: numberOf(data, 'mostOutputBytes'),
  };
}

function cut(issue: ProgramIssue): ProgramIssue {
  return { ...issue, detail: textWithin(issue.detail, mostIssueBytes) };
}

function answerFrom(run: ProgramRun, mostOutputBytes: number): ProgramAnswerData {
  if (run.ran === 'raised' || run.ran === 'exhausted') {
    return { ...run, issue: cut(run.issue) };
  }
  if (run.ran !== 'answered') {
    return run;
  }
  const bytes = jsonBytesWithin(run.value, mostOutputBytes);
  return bytes > mostOutputBytes
    ? { ran: 'oversized', work: run.work }
    : { ran: 'answered', output: JSON.stringify(run.value), bytes, work: run.work };
}

function evaluated(request: ProgramRequestData, clock: () => number): ProgramAnswerData {
  const compiled = compileProgram(request.source, request.dialect);
  if ('issues' in compiled) {
    return { ran: 'refused', issues: compiled.issues.map((issue) => cut(issue)) };
  }
  const input: unknown = JSON.parse(request.input);
  if (!isJson(input)) {
    return tooDeep;
  }
  const run = compiled.program.run(input, {
    limits: request.limits,
    outputs: 'exactly one',
    deadline: { milliseconds: request.deadlineAt - clock(), clock },
  });
  return answerFrom(run, request.mostOutputBytes);
}

export function answerOf(data: unknown, clock: () => number): ProgramAnswerData {
  return evaluated(requestOf(data), clock);
}
