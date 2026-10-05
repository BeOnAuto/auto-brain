import type { Presenter } from '@beonauto/operations';

import { specWordsFor } from '../plain-language/spec-words.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { executionPresenter } from './execution-presenter.ts';
import { specPresenter } from './spec-presenter.ts';

export function makeSpecPresenters(primitives: readonly Primitive[]): readonly Presenter[] {
  const words = specWordsFor(primitives);
  return [executionPresenter(words), specPresenter(words)];
}
