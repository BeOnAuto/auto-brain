import { Result, type Schema } from 'effect';

import type { ListedTool } from '../bounds/tool-results.ts';
import { decodedDocument, type DocumentProblem } from '../openapi/api-document.ts';
import { derivedTools, type DerivedTools } from '../openapi/api-tools.ts';

type DocumentFields = Readonly<Record<string, Schema.Json>>;

export const unfollowedReference =
  'A reference the runtime cannot follow: a schema of a tool server may refer only to #/components/schemas/<name> of its own document';

export function documentOf(paths: DocumentFields, more: DocumentFields = {}): DocumentFields {
  return { openapi: '3.1.0', info: { title: 'Notes', version: '1' }, paths, ...more };
}

export function toolsOf(document: DocumentFields): DerivedTools {
  return Result.getOrThrow(Result.flatMap(decodedDocument(document), derivedTools));
}

export function problemsOf(document: DocumentFields): readonly DocumentProblem[] {
  return Result.getOrThrow(Result.flip(Result.flatMap(decodedDocument(document), derivedTools)));
}

export function toolNamed(document: DocumentFields, name: string): ListedTool | undefined {
  return toolsOf(document)
    .operations.map(({ tool }) => tool)
    .find((tool) => tool.name === name);
}
