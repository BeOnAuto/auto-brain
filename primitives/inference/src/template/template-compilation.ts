import { Result } from 'effect';
import { Tokenizer, TypeGuards, type StaticAnalysis, type Template } from 'liquidjs';

import type { CompiledTemplate, TemplateIssue, VariableReference, VariableSegment } from './compiled-template.ts';
import { engineFailureOf } from './engine-failure.ts';
import { engine, templateLimits } from './liquid-engine.ts';
import { markerIssues, outlineOf } from './system-block.ts';
import { renderTemplate } from './template-rendering.ts';

const namePattern = /[A-Za-z_][\w-]*/gu;

const clearerMessages: ReadonlyMap<string, string> = new Map([
  [
    'AssertionError: parse length limit exceeded',
    `A template may take at most ${templateLimits.characters} characters`,
  ],
]);

function parsedTemplates(body: string, firstLine: number): Result.Result<Template[], readonly TemplateIssue[]> {
  try {
    return Result.succeed(engine.parse(body));
  } catch (error) {
    const { line, message } = engineFailureOf(error, firstLine);
    return Result.fail([{ line, detail: clearerMessages.get(message) ?? message }]);
  }
}

function nameIssues(body: string, firstLine: number): readonly TemplateIssue[] {
  let names = 0;
  for (const token of new Tokenizer(body).readTopLevelTokens(engine.options)) {
    if (TypeGuards.isTagToken(token) || TypeGuards.isOutputToken(token)) {
      names += token.content.match(namePattern)?.length ?? 0;
    }
  }
  return names > templateLimits.names
    ? [
        {
          line: firstLine,
          detail: `A template may use at most ${templateLimits.names} names in its tags and outputs (variables, properties, filters and keywords); this one uses ${names}`,
        },
      ]
    : [];
}

function variableReferences(analysis: () => StaticAnalysis, firstLine: number): readonly VariableReference[] {
  const references: VariableReference[] = [];
  for (const variables of Object.values(analysis().globals)) {
    for (const variable of variables) {
      const path: VariableSegment[] = [];
      for (const segment of variable.segments) {
        path.push(typeof segment === 'object' ? null : segment);
      }
      references.push({ path, line: firstLine + variable.location.row - 1 });
    }
  }
  return references.toSorted((first, second) => first.line - second.line);
}

export function compileTemplate(
  body: string,
  firstLine: number,
): Result.Result<CompiledTemplate, readonly TemplateIssue[]> {
  const parsing = parsedTemplates(body, firstLine);
  if (Result.isFailure(parsing)) {
    return Result.fail(parsing.failure);
  }
  const templates = parsing.success;
  const outline = outlineOf(() => templates, firstLine);
  const issues = [...markerIssues(outline), ...nameIssues(body, firstLine)];
  if (issues.length > 0) {
    return Result.fail(issues);
  }
  const hasInstructions = outline.top.length > 0;
  return Result.succeed({
    hasInstructions,
    hasMessage: outline.hasMessage,
    variables: variableReferences(() => engine.analyzeSync(templates, { partials: false }), firstLine),
    render: (scope) => renderTemplate(() => templates, hasInstructions, scope, firstLine),
  });
}
