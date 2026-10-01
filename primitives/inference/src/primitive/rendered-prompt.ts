import { InvalidInput } from '@beonauto/operations';
import { Effect, JsonPointer, Result } from 'effect';

import type { CompiledTemplate, RenderedPrompt, RenderFailure, TemplateScope } from '../template/compiled-template.ts';

const inputPath = /^input\./u;

const exceeded = { memory: 'more memory', time: 'more time' } as const;

function pointerOf(variable: string): string {
  return inputPath.test(variable)
    ? variable
        .replace(inputPath, '')
        .split('.')
        .map((segment) => `/${JsonPointer.escapeToken(segment)}`)
        .join('')
    : '';
}

function refusal(detail: string, issue: string, pointer = ''): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail: issue }] });
}

function refusalOf(failure: RenderFailure): InvalidInput {
  if (failure.reason === 'missing_variable') {
    return refusal(
      'The template reads a field the input does not have',
      `Line ${failure.line}: the template reads ${failure.variable}, which this input does not have`,
      pointerOf(failure.variable),
    );
  }
  if (failure.reason === 'too_long') {
    return refusal(
      `With this input the ${failure.part} of the prompt would be longer than the template may render`,
      `Line ${failure.line}: the ${failure.part} grows past 200000 characters here`,
    );
  }
  if (failure.reason === 'limit_exceeded') {
    return refusal(
      `Rendering the template with this input takes ${exceeded[failure.limit]} than a render may`,
      `Line ${failure.line}: the render stopped here`,
    );
  }
  return refusal('The template cannot be rendered with this input', `Line ${failure.line}: ${failure.detail}`);
}

const emptyMessage = refusal(
  'With this input the template renders an empty message',
  'The message the template renders from this input is empty',
);

export function renderedPrompt(
  template: CompiledTemplate,
  scope: TemplateScope,
): Effect.Effect<RenderedPrompt, InvalidInput> {
  return Result.match(template.render(scope), {
    onFailure: (failure) => Effect.fail(refusalOf(failure)),
    onSuccess: (prompt) => (prompt.message.trim() === '' ? Effect.fail(emptyMessage) : Effect.succeed(prompt)),
  });
}
