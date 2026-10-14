import type { Noun } from '@on.auto/operations';
import type { Schema } from 'effect';

import { markdownOf } from './markdown-writer.ts';
import { sectionOf, type Overview, type OverviewSection } from './overview.ts';
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
