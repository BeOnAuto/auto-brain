import { pointerOf, problem, type SettingProblem } from '@beonauto/config';
import { parsedTemplate, type ParsedTemplate, type VariableSegment } from '@beonauto/specs/template';
import { Result } from 'effect';

import { interactionEngine } from '../document/request-templates.ts';
import {
  renderedArguments,
  requestFieldNames,
  type ArgumentTemplates,
  type TemplateFields,
} from './channel-arguments.ts';
import { channelsSetting } from './channel-entries.ts';

export interface TemplateSet {
  readonly names: readonly string[];
  readonly sample: TemplateFields;
  readonly structured: string;
}

export const requestTemplates: TemplateSet = {
  names: requestFieldNames,
  sample: {
    to: '#approvals',
    message: 'Please review the brief.',
    run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    function: 'approve-brief',
    expires_at: '2026-10-09T09:00:00.000Z',
    answer_schema: { type: 'object', properties: { choice: { type: 'string' } } },
  },
  structured: 'answer_schema',
};

const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' });

function nestsUnder({ names }: TemplateSet, first: string): boolean {
  return names.some((name) => name.startsWith(`${first}.`));
}

function nameOf(set: TemplateSet, path: readonly VariableSegment[]): string {
  const [first, ...nested] = path.map(String);
  const outer = String(first);
  return nested.length > 0 && nestsUnder(set, outer) ? [outer, nested[0]].join('.') : outer;
}

function reads(set: TemplateSet, path: readonly VariableSegment[]): boolean {
  const name = nameOf(set, path);
  return set.names.includes(name) || nestsUnder(set, name);
}

function variableProblems(set: TemplateSet, parsed: ParsedTemplate, pointer: string): readonly SettingProblem[] {
  const unknown = [
    ...new Set(parsed.variables.filter(({ path }) => !reads(set, path)).map(({ path }) => nameOf(set, path))),
  ];
  return unknown.map((name) =>
    problem(
      channelsSetting,
      pointer,
      `Reads ${name}, which this template of a channel does not have; it reads ${listed.format(set.names)}`,
    ),
  );
}

function argumentTemplate(
  set: TemplateSet,
  text: string,
  pointer: string,
): Result.Result<ParsedTemplate, readonly SettingProblem[]> {
  if (text.includes('${')) {
    return Result.fail([
      problem(channelsSetting, pointer, 'Expected no ${ in a template, which never holds a secret; write $$ for a $'),
    ]);
  }
  const parsed = parsedTemplate(interactionEngine, text, 1);
  if (Result.isFailure(parsed)) {
    return Result.fail(parsed.failure.map(({ detail }) => problem(channelsSetting, pointer, detail)));
  }
  const problems = [
    ...parsed.success.issues.map(({ detail }) => problem(channelsSetting, pointer, detail)),
    ...variableProblems(set, parsed.success, pointer),
  ];
  return problems.length > 0 ? Result.fail(problems) : Result.succeed(parsed.success);
}

function rendersText(set: TemplateSet, argument: string, template: ParsedTemplate): boolean {
  const rendered = renderedArguments(new Map([[argument, template]]), set.sample);
  return (
    Result.isSuccess(rendered) ||
    rendered.failure.reason !== 'argument' ||
    rendered.failure.failure.reason !== 'not_text'
  );
}

function textProblems(set: TemplateSet, place: readonly string[], templates: ArgumentTemplates) {
  return [...templates]
    .filter(([argument, template]: readonly [string, ParsedTemplate]) => !rendersText(set, argument, template))
    .map(([argument]: readonly [string, ParsedTemplate]) =>
      problem(
        channelsSetting,
        pointerOf([...place, argument]),
        `Renders a value that is not text; write | json after a structured value such as ${set.structured}`,
      ),
    );
}

export function argumentTemplates(
  place: readonly string[],
  written: Readonly<Record<string, string>>,
  set: TemplateSet,
): Result.Result<ArgumentTemplates, readonly SettingProblem[]> {
  const problems: SettingProblem[] = [];
  const templates = new Map<string, ParsedTemplate>();
  for (const [argument, text] of Object.entries(written)) {
    const compiled = argumentTemplate(set, text, pointerOf([...place, argument]));
    if (Result.isFailure(compiled)) {
      problems.push(...compiled.failure);
    } else {
      templates.set(argument, compiled.success);
    }
  }
  if (problems.length > 0) {
    return Result.fail(problems);
  }
  const notText = textProblems(set, place, templates);
  return notText.length > 0 ? Result.fail(notText) : Result.succeed(templates);
}
