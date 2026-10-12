import {
  frontMatterIn,
  reportedIssues,
  splitDocument,
  type DocumentParts,
  type ReadFrontMatter,
} from '@beonauto/definitions/document';
import { Result } from 'effect';

import { largestBriefVariables } from '../brief/brief-dataset.ts';
import { briefRenderIssues, compiledBrief } from '../brief/brief-template.ts';
import { dataDigestOf } from '../data/data-digest.ts';
import { issuesOf, type Checked } from './checked-parts.ts';
import { derivedSchemasOf } from './derived-schemas.ts';
import { doneOf, partsOf, type Done } from './document-parts.ts';
import { decodeFrontMatter, predictionFrontMatter, type PredictionFrontMatter } from './front-matter.ts';
import type { PredictionFunctionDefinitionDocument } from './prediction-document.ts';

function assembled(front: PredictionFrontMatter, done: Done, lines: ReadFrontMatter['lines']) {
  const { predicts, data, evaluation, source, rules, brief } = done;
  const document: PredictionFunctionDefinitionDocument = {
    ...(front.description === undefined ? {} : { description: front.description }),
    predicts,
    data: data.data,
    dataSha256: dataDigestOf(data.data, predicts.period),
    evaluation,
    source,
    rules,
    brief,
    dataExpressions: data.expressions,
    schemas: derivedSchemasOf(predicts, data.data),
    lines,
  };
  const rendered = briefRenderIssues(brief, largestBriefVariables(document));
  return rendered.length > 0 ? Result.fail(rendered) : Result.succeed(document);
}

function documentFrom(reading: ReadFrontMatter, parts: DocumentParts): Checked<PredictionFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(reading.root);
  if (reading.issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...reading.issues, ...issuesOf(() => compiledBrief(parts))]);
  }
  const front = decoded.success;
  const done = doneOf(() => partsOf(front, reading, parts));
  return Result.isSuccess(done) ? assembled(front, done.success, reading.lines) : Result.fail(done.failure);
}

function documentOf(parts: DocumentParts): Checked<PredictionFunctionDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, predictionFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => compiledBrief(parts))])
    : documentFrom(reading.success, parts);
}

export function parsePredictionDocument(source: string): Checked<PredictionFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A prediction function definition'), documentOf),
    reportedIssues,
  );
}
