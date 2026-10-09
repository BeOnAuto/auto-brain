import {
  frontMatterIn,
  reportedIssues,
  splitDocument,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
} from '@beonauto/definitions/document';
import { Result } from 'effect';

import { asksASystem, callFrom } from './call-parts.ts';
import { decodeFrontMatter, interactionFrontMatter } from './front-matter.ts';
import type { InteractionFunctionDefinitionDocument } from './interaction-document.ts';
import { requestFrom } from './request-parts.ts';
import { messageOf, type Checked } from './written-parts.ts';

function bodyIssuesOf(parts: DocumentParts): readonly DocumentIssue[] {
  if (asksASystem(parts)) {
    return [];
  }
  const message = messageOf(parts);
  return Result.isFailure(message) ? message.failure : [];
}

function documentFrom(reading: ReadFrontMatter, parts: DocumentParts): Checked<InteractionFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(reading.root);
  if (reading.issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...reading.issues, ...bodyIssuesOf(parts)]);
  }
  const written = decoded.success;
  return written.call === undefined
    ? requestFrom(written, reading, parts)
    : callFrom(written, written.call, reading.lines, parts);
}

function documentOf(parts: DocumentParts): Checked<InteractionFunctionDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, interactionFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...bodyIssuesOf(parts)])
    : documentFrom(reading.success, parts);
}

export function parseInteractionDocument(source: string): Checked<InteractionFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'An interaction function definition'), documentOf),
    reportedIssues,
  );
}
