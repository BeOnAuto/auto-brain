import { pointerOf, problem, type SettingProblem } from '@beonauto/config';
import { parsedTemplate, type ParsedTemplate } from '@beonauto/specs/template';
import { Result } from 'effect';

import { interactionEngine } from '../document/request-templates.ts';
import { renderedArguments, requestFieldNames, type RequestFields } from './channel-arguments.ts';
import { channelsSetting } from './channel-entries.ts';

const sampleFields: RequestFields = {
  to: '#approvals',
  message: 'Please review the brief.',
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  function: 'approve-brief',
  expires_at: '2026-10-09T09:00:00.000Z',
  answer_schema: { type: 'object', properties: { choice: { type: 'string' } } },
};

const fieldNames: ReadonlySet<string> = new Set(requestFieldNames);

const fieldsInWords = 'to, message, run_id, function, expires_at and answer_schema';

function variableProblems(parsed: ParsedTemplate, pointer: string): readonly SettingProblem[] {
  const unknown = [...new Set(parsed.variables.map(({ path }) => String(path[0])))].filter(
    (name) => !fieldNames.has(name),
  );
  return unknown.map((name) =>
    problem(
      channelsSetting,
      pointer,
      `Reads ${name}, which a template of a channel does not have; it reads ${fieldsInWords}`,
    ),
  );
}

function argumentTemplate(text: string, pointer: string): Result.Result<ParsedTemplate, readonly SettingProblem[]> {
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
    ...variableProblems(parsed.success, pointer),
  ];
  return problems.length > 0 ? Result.fail(problems) : Result.succeed(parsed.success);
}

function rendersText(argument: string, template: ParsedTemplate): boolean {
  const rendered = renderedArguments({ with: new Map([[argument, template]]) }, sampleFields);
  return (
    Result.isSuccess(rendered) ||
    rendered.failure.reason !== 'argument' ||
    rendered.failure.failure.reason !== 'not_text'
  );
}

function textProblems(name: string, templates: ReadonlyMap<string, ParsedTemplate>): readonly SettingProblem[] {
  return [...templates]
    .filter(([argument, template]: readonly [string, ParsedTemplate]) => !rendersText(argument, template))
    .map(([argument]: readonly [string, ParsedTemplate]) =>
      problem(
        channelsSetting,
        pointerOf([name, 'with', argument]),
        'Renders a value that is not text; write | json after a structured value such as answer_schema',
      ),
    );
}

export function argumentTemplates(
  name: string,
  written: Readonly<Record<string, string>>,
): Result.Result<ReadonlyMap<string, ParsedTemplate>, readonly SettingProblem[]> {
  const problems: SettingProblem[] = [];
  const templates = new Map<string, ParsedTemplate>();
  for (const [argument, text] of Object.entries(written)) {
    const compiled = argumentTemplate(text, pointerOf([name, 'with', argument]));
    if (Result.isFailure(compiled)) {
      problems.push(...compiled.failure);
    } else {
      templates.set(argument, compiled.success);
    }
  }
  if (problems.length > 0) {
    return Result.fail(problems);
  }
  const notText = textProblems(name, templates);
  return notText.length > 0 ? Result.fail(notText) : Result.succeed(templates);
}
