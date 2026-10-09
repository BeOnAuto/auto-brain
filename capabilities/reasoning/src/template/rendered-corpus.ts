import { createHash } from 'node:crypto';

import { Result } from 'effect';

import type { CorpusCase } from './rendering-corpus.ts';
import { compileTemplate } from './template-compilation.ts';

const moment = { today: '2026-10-01', now: '2026-10-01T09:30:00.000Z' };

const mostCharactersKept = 2000;

function kept(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text.length <= mostCharactersKept
    ? value
    : { sha256: createHash('sha256').update(text).digest('hex'), length: text.length };
}

export function renderedCorpusOf(corpus: readonly CorpusCase[]): readonly unknown[] {
  return corpus.map((each) => ({ body: kept(each.body), rendering: renderingOf(each) }));
}

function renderingOf({ body, input, firstLine }: CorpusCase): unknown {
  return Result.match(compileTemplate(body, firstLine), {
    onFailure: (issues) => ({ issues }),
    onSuccess: (template) =>
      Result.match(template.render({ input, ...moment }), {
        onSuccess: (rendered) => ({ rendered: kept(rendered) }),
        onFailure: (failure) => ({ failure }),
      }),
  });
}
