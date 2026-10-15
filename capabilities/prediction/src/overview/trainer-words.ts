import { durationInWords, named, paragraph, sectionOf, type OverviewSection } from '@on.auto/definitions';
import { splitDocument } from '@on.auto/definitions/document';
import { readableTemplate } from '@on.auto/definitions/template';
import { Result } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { BuildSource } from '../document/prediction-document.ts';

const { candidatesInABuild, scoringACandidateMs } = predictionBounds;

function askedThrough({ through, to }: BuildSource) {
  return through === undefined
    ? paragraph("Each build asks for candidate models in the playbook's inbox, as a request to ", named(to), '.')
    : paragraph('Each build asks for candidate models through the interaction function ', named(through), '.');
}

function briefBlocks(source: string) {
  const { body, bodyLine } = Result.getOrThrow(splitDocument(source, 'A prediction function definition'));
  const brief = readableTemplate({ text: body, firstLine: bodyLine });
  return brief.length === 0
    ? [paragraph('Its brief holds no text a trainer reads, so its trainer reads the rows and the rules alone.')]
    : [
        paragraph('Its trainer reads the brief first, with the values of each build in place of the names in bold:'),
        ...brief,
      ];
}

export function trainerSection(buildSource: BuildSource, source: string): OverviewSection {
  return sectionOf(
    'Who trains it',
    askedThrough(buildSource),
    paragraph(
      `A build waits at most ${durationInWords(buildSource.expiresMs)} for its candidates, and the playbook then scores up to ${candidatesInABuild} of them, each within ${durationInWords(scoringACandidateMs)}.`,
    ),
    ...briefBlocks(source),
  );
}
