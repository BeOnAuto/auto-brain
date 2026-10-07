import { isJson, isObject, type Json } from '../dsl/json.ts';
import { jsonBytesWithin, mostIssueBytes, textWithin } from '../programs/byte-sizes.ts';
import type { CompiledProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { ProgramRun } from '../programs/program-running.ts';
import type { ProgramIssue } from '../programs/program-tree.ts';
import type { ProgramAnswerSchema, ProgramJob } from './program-messages.ts';

export type ProgramAnswerData = typeof ProgramAnswerSchema.Encoded;

export interface OutputIssue {
  readonly pointer: string;
  readonly detail: string;
}

export type OutputCheck = (output: Json) => readonly OutputIssue[];

export interface ProgramHost {
  readonly now: () => number;
  readonly compile: (source: string, dialect: Dialect) => CompiledProgram;
  readonly check: OutputCheck;
}

const tooDeep: ProgramAnswerData = {
  ran: 'exhausted',
  limit: 'value depth',
  issue: { detail: 'The input nests too deep', span: { start: 0, end: 0 } },
  work: 0,
};

export const unchecked: OutputCheck = () => [];

function cut(issue: ProgramIssue): ProgramIssue {
  return { ...issue, detail: textWithin(issue.detail, mostIssueBytes) };
}

function checkedAnswer(value: Json, bytes: number, work: number, check: OutputCheck): ProgramAnswerData {
  const issues = check(value);
  return issues.length === 0
    ? { ran: 'answered', output: JSON.stringify(value), bytes, work }
    : {
        ran: 'mismatched',
        issues: issues.map(({ pointer, detail }) => ({
          pointer: textWithin(pointer, mostIssueBytes),
          detail: textWithin(detail, mostIssueBytes),
        })),
        work,
      };
}

function answerFrom(run: ProgramRun, mostOutputBytes: number, check: OutputCheck): ProgramAnswerData {
  if (run.ran === 'raised' || run.ran === 'exhausted') {
    return { ...run, issue: cut(run.issue) };
  }
  if (run.ran !== 'answered') {
    return run;
  }
  const bytes = jsonBytesWithin(run.value, mostOutputBytes);
  return bytes > mostOutputBytes
    ? { ran: 'oversized', work: run.work }
    : checkedAnswer(run.value, bytes, run.work, check);
}

export function answerOf(request: ProgramJob, { now, compile, check }: ProgramHost): ProgramAnswerData {
  const compiled = compile(request.source, request.dialect);
  if ('issues' in compiled) {
    return { ran: 'refused', issues: compiled.issues.map((issue) => cut(issue)) };
  }
  const input: unknown = JSON.parse(request.input);
  const variables: unknown = JSON.parse(request.variables);
  if (!isJson(input) || !isJson(variables) || !isObject(variables)) {
    return tooDeep;
  }
  const run = compiled.program.run(input, {
    limits: request.limits,
    outputs: 'exactly one',
    variables,
    deadline: { milliseconds: request.deadlineAt - now(), clock: now },
  });
  return answerFrom(run, request.mostOutputBytes, check);
}
