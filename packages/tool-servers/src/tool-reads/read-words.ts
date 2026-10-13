import { capitalized, counted, type Noun } from '@on.auto/operations';
import { Predicate, type Schema } from 'effect';

import { isReadOnly, type ToolAnnotations } from '../bounds/tool-results.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { inWords, namesListed, toolInWords } from '../names/tool-words.ts';
import type { ArgumentCheck } from './argument-checks.ts';
import type { DryRun } from './dry-run-schema.ts';

interface Described extends ToolReference {
  readonly input_schema: Schema.JsonObject;
  readonly annotations?: ToolAnnotations;
}

const argumentNoun: Noun = { one: 'argument', other: 'arguments' };

export const readingTask = {
  introspect: 'describe a tool of a tool server',
  validate: 'check the arguments of a tool of a tool server',
  dry_run: 'dry run a call of a tool of a tool server',
} as const;

export function toolRead(verb: string, asked: ToolReference): string {
  return `${verb} ${toolInWords(asked)}`;
}

function argumentsTaken({ input_schema: { properties } }: Described): string {
  const names = Predicate.isObject(properties) ? Object.keys(properties).map((name) => inWords(name)) : [];
  return names.length === 0
    ? 'takes no arguments'
    : `takes ${counted(names.length, argumentNoun)}, ${namesListed(names)},`;
}

function readingOf(annotations: ToolAnnotations | undefined): string {
  return isReadOnly(annotations)
    ? "only reads, by its server's own account"
    : 'is not marked read-only by its server, so it may change something';
}

export function introspected(described: Described): string {
  return `${capitalized(toolInWords(described))} ${argumentsTaken(described)} and ${readingOf(described.annotations)}; what it does and what it takes are in the details.`;
}

export function validated({ valid }: ArgumentCheck, asked: ToolReference): string {
  const tool = toolInWords(asked);
  if (valid === null) {
    return `The arguments of ${tool} could not be checked on this server; the details say why.`;
  }
  return valid
    ? `The arguments are what ${tool} takes.`
    : `The arguments are not what ${tool} takes; the details say where and why.`;
}

function argumentsInWords({ arguments: checked }: DryRun): string {
  if (checked === null) {
    return '';
  }
  if (checked.valid === null) {
    return ', though its arguments could not be checked on this server';
  }
  return checked.valid ? ', and its arguments are what it takes' : ', but its arguments are not what it takes';
}

function whyNot({ caller_may: callerMay, allowed, server }: DryRun): readonly string[] {
  const unreached =
    server.because === 'key_refused'
      ? 'its tool server did not accept the key this server gives it'
      : 'its tool server could not be asked just now';
  return [
    ...(callerMay ? [] : ['the caller may not change this playbook, which a call needs']),
    ...(allowed ? [] : ['whoever runs this server does not allow the tool']),
    ...(server.reachable === 'yes' ? [] : [unreached]),
  ];
}

export function dryRunWords(answer: DryRun, asked: ToolReference): string {
  const call = `A call of ${toolInWords(asked)}`;
  if (!answer.would_run) {
    return `${call} would not be made now: ${whyNot(answer).join('; ')}.`;
  }
  const reads = answer.read_only === true ? "only reads, by its server's own account" : 'may change something';
  return `${call} would be made now, and the tool ${reads}${argumentsInWords(answer)}.`;
}
