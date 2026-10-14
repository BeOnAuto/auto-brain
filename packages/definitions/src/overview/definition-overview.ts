import type { Noun } from '@on.auto/operations';
import type { Schema } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { DefinitionUser, UserRelation } from '../used-by/user-relations.ts';
import { appendedSection, markdownOf } from './markdown-writer.ts';
import { bulletList, named, sectionOf, type Overview, type OverviewSection } from './overview.ts';
import { schemaBlocks } from './schema-words.ts';

interface OverviewSubject {
  readonly description?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
}

export type SectionsOf<Parsed> = (parsed: Parsed, source: string) => readonly OverviewSection[];

interface OverviewRequest {
  readonly name: string;
  readonly noun: Noun;
  readonly summary: OverviewSubject;
  readonly sections?: readonly OverviewSection[] | undefined;
}

export function inputSection(schema?: Schema.JsonObject): OverviewSection {
  return sectionOf(
    'What it needs',
    ...schemaBlocks(schema, 'It takes any input, which its document does not describe.'),
  );
}

export function outputSection(schema?: Schema.JsonObject): OverviewSection {
  return sectionOf(
    'What it produces',
    ...schemaBlocks(schema, 'It produces any output, which its document does not describe.'),
  );
}

const relationWords: Readonly<Record<UserRelation, string>> = {
  calls: 'calls it',
  'sends-builds': 'sends it builds to train',
  'asks-approval': 'asks it to approve a version',
  'remembers-runs': 'remembers its runs',
  'remembers-changes': 'remembers its changes',
};

export function usedBySection(users: readonly DefinitionUser[]): OverviewSection {
  return sectionOf(
    'Used by',
    bulletList(
      users.map(({ type, name, relation }) => [
        `The ${definitionResourceLabel(type)} `,
        named(name),
        ` ${relationWords[relation]}.`,
      ]),
    ),
  );
}

function openingOf(description: string | undefined, noun: Noun): string {
  return description === undefined || description.trim() === ''
    ? `This ${noun.one} has no description yet.`
    : description;
}

function overviewOf({ name, noun, summary, sections }: OverviewRequest): Overview {
  const { description, inputSchema, outputSchema } = summary;
  return {
    title: name,
    opening: [openingOf(description, noun)],
    sections: sections ?? [inputSection(inputSchema), outputSection(outputSchema)],
  };
}

export function writtenOverview(request: OverviewRequest): string {
  return markdownOf(overviewOf(request));
}

export function overviewWithUsers(overview: string, users: readonly DefinitionUser[]): string {
  return users.length === 0 ? overview : appendedSection(overview, usedBySection(users));
}
