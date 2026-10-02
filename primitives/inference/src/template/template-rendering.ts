import { Result } from 'effect';
import { Context, toValue, toValueSync, type Emitter, type Template } from 'liquidjs';

import type { PromptPart, RenderedPrompt, RenderFailure, TemplateScope } from './compiled-template.ts';
import { engineFailureOf } from './engine-failure.ts';
import { engine, instructionsBegin, instructionsEnd, templateLimits } from './liquid-engine.ts';
import { outputText } from './output-text.ts';
import { PromptTooLong } from './prompt-too-long.ts';

interface PromptEmitter extends Emitter {
  readonly prompt: () => RenderedPrompt;
}

const exceededLimits: ReadonlyMap<string, 'memory' | 'time'> = new Map([
  ['memory alloc limit exceeded', 'memory'],
  ['template render limit exceeded', 'time'],
]);

function promptEmitter(hasInstructions: boolean): PromptEmitter {
  const texts: Record<PromptPart, string> = { instructions: '', message: '' };
  let part: PromptPart = 'message';
  return {
    buffer: '',
    write(html: unknown) {
      if (html === instructionsBegin || html === instructionsEnd) {
        part = html === instructionsBegin ? 'instructions' : 'message';
        return;
      }
      const text = outputText(toValue(html));
      if (texts[part].length + text.length > templateLimits.renderedCharacters) {
        throw new PromptTooLong({ part });
      }
      texts[part] += text;
    },
    prompt: () =>
      hasInstructions ? { instructions: texts.instructions, message: texts.message } : { message: texts.message },
  };
}

function renderFailureOf(error: unknown, firstLine: number): RenderFailure {
  const { line, message, cause, missingVariable } = engineFailureOf(error, firstLine);
  if (cause instanceof PromptTooLong) {
    return { reason: 'too_long', part: cause.part, line };
  }
  if (missingVariable !== undefined) {
    return { reason: 'missing_variable', variable: missingVariable, line };
  }
  const limit = exceededLimits.get(message);
  return limit === undefined ? { reason: 'failed', detail: message, line } : { reason: 'limit_exceeded', limit, line };
}

export function renderTemplate(
  templates: () => Template[],
  hasInstructions: boolean,
  scope: TemplateScope,
  firstLine: number,
): Result.Result<RenderedPrompt, RenderFailure> {
  const emitter = promptEmitter(hasInstructions);
  const variables = { input: scope.input, today: scope.today, now: scope.now };
  const context = new Context(variables, engine.options, { sync: true }, { liquid: engine });
  try {
    toValueSync(engine.renderer.renderTemplates(templates(), context, emitter));
  } catch (error) {
    return Result.fail(renderFailureOf(error, firstLine));
  }
  return Result.succeed(emitter.prompt());
}
