import { readFile, stat } from 'node:fs/promises';

import type { FetchLike } from '@modelcontextprotocol/client';
import { readYaml, type YamlKind } from '@on.auto/config';
import { nestedDeeperThan } from '@on.auto/json-schema';
import { Result } from 'effect';

import { counted } from '../connections/observed-requests.ts';
import type { ApiDocumentSource } from '../settings/server-settings.ts';

export const documentBounds = { bytes: 4_194_304, operations: 500, readMs: 10_000, nesting: 128 } as const;

export interface DocumentReading {
  readonly fetch: FetchLike;
  readonly readMs: number;
}

type Read = Result.Result<unknown, string>;

const yamlDocument: YamlKind = {
  noun: 'an OpenAPI document',
  mapping: 'An OpenAPI document is a mapping of its fields',
  mostDepth: documentBounds.nesting,
  emptyIsMapping: false,
};

const tooLarge = `The document takes more than the ${documentBounds.bytes} bytes a document of a tool server may take`;

const accepted = 'application/json, application/yaml;q=0.9, text/yaml;q=0.9, */*;q=0.1';

const mostProblemsNamed = 3;

function unreadAnswer(status: number): string {
  return status >= 300 && status < 400
    ? `The document could not be read: its URL answered a redirect, HTTP ${status}, which the runtime does not follow; give the address it redirects to`
    : `The document could not be read: its URL answered HTTP ${status}`;
}

function parsedText(text: string): Read {
  try {
    const parsed: unknown = JSON.parse(text);
    return Result.succeed(parsed);
  } catch {
    const reading = readYaml(text, yamlDocument);
    if ('document' in reading) {
      return Result.succeed(reading.document.value);
    }
    const located = reading.problems
      .slice(0, mostProblemsNamed)
      .map(({ position, detail }) => `line ${position.line}, column ${position.column}: ${detail}`);
    return Result.fail(`The document is neither JSON nor YAML: ${located.join('; ')}`);
  }
}

function boundedParse(text: string): Read {
  return Result.flatMap(parsedText(text), (value) =>
    nestedDeeperThan(value, documentBounds.nesting)
      ? Result.fail(`The document nests values more than ${documentBounds.nesting} levels deep`)
      : Result.succeed(value),
  );
}

async function textAt(url: string, { fetch, readMs }: DocumentReading): Promise<Result.Result<string, string>> {
  const signal = AbortSignal.timeout(readMs);
  let overflowed = false;
  try {
    const response = await fetch(url, { headers: { accept: accepted }, redirect: 'manual', signal });
    if (!response.ok) {
      await response.body?.cancel();
      return Result.fail(unreadAnswer(response.status));
    }
    const text = await counted(response, documentBounds.bytes, () => {
      overflowed = true;
    }).text();
    return Result.succeed(text);
  } catch (failure) {
    if (overflowed) {
      return Result.fail(tooLarge);
    }
    return Result.fail(
      signal.aborted
        ? `The document was not read within ${readMs} ms`
        : `The document could not be read: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }
}

async function textIn(path: string): Promise<Result.Result<string, string>> {
  try {
    if ((await stat(path)).size > documentBounds.bytes) {
      return Result.fail(tooLarge);
    }
    return Result.succeed(await readFile(path, 'utf8'));
  } catch (failure) {
    const code = String(Reflect.get(new Object(failure), 'code'));
    return Result.fail(code === 'ENOENT' ? 'The document does not exist' : `The document could not be read (${code})`);
  }
}

export async function documentOf(source: ApiDocumentSource, reading: DocumentReading): Promise<Read> {
  const text = source.kind === 'url' ? await textAt(source.url, reading) : await textIn(source.path);
  return Result.flatMap(text, boundedParse);
}
