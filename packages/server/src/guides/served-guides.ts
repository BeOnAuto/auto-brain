import { readFileSync } from 'node:fs';

import type { DefinitionType, Guide, Recipe } from '@beonauto/api';
import type { Capability } from '@beonauto/definitions';
import { capitalized } from '@beonauto/operations';

import { withLinksResolved } from './page-links.ts';
import { recipesFor } from './recipes.ts';
import { withoutSiteMarkup } from './site-markup.ts';
import { terminologyGuideOf } from './terminology-guide.ts';

export interface ServedGuides {
  readonly definitionTypes: readonly DefinitionType[];
  readonly guides: readonly Guide[];
  readonly recipes: readonly Recipe[];
}

const documentation = new URL('../../../../docs/', import.meta.url);

const terminologyPage = 'concepts/terminology.md';

function pageOfGuide(guide: string): string {
  return `reference/${guide.replace(/-function$/u, '')}-format.md`;
}

function pageText(page: string): string {
  return readFileSync(new URL(page, documentation), 'utf8');
}

function typeGuideOf({ noun, guide }: Pick<Capability, 'noun' | 'guide'>): Guide {
  const page = pageOfGuide(guide.name);
  const text = withLinksResolved(withoutSiteMarkup(pageText(page)), page);
  return {
    name: guide.name,
    title: `${capitalized(noun.one)} format`,
    description: `How ${noun.other} are written: their document, fields, examples and bounds.`,
    text: guide.onThisServer === undefined ? text : `${text.trimEnd()}\n\n${guide.onThisServer}\n`,
  };
}

export function servedGuidesOf(capabilities: readonly Capability[]): ServedGuides {
  const definitionTypes: readonly DefinitionType[] = capabilities.map(({ type, noun, guide }) => ({
    type,
    noun: noun.one,
    guide: guide.name,
  }));
  const guides = [
    terminologyGuideOf(
      pageText(terminologyPage),
      definitionTypes.map(({ noun }) => noun),
    ),
    ...capabilities.map(({ noun, guide }) => typeGuideOf({ noun, guide })),
  ];
  return { definitionTypes, guides, recipes: recipesFor(guides) };
}
