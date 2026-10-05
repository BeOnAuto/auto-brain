import { JsonPointer, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

import type { SettingProblem } from './mcp-settings.ts';

type PathSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const strictly = { onExcessProperty: 'error', errors: 'all' } as const;

function isPropertyKey(segment: PathSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

export function pointerOf(path: readonly PropertyKey[]): string {
  return path.map((segment) => `/${JsonPointer.escapeToken(String(segment))}`).join('');
}

export function problem(setting: string, pointer: string, detail: string): SettingProblem {
  return { setting, detail: `${pointer === '' ? '/' : pointer}: ${detail}` };
}

function parsedJson(setting: string, text: string): Result.Result<unknown, readonly SettingProblem[]> {
  try {
    const parsed: unknown = JSON.parse(text);
    return Result.succeed(parsed);
  } catch {
    return Result.fail([problem(setting, '', 'Expected JSON')]);
  }
}

export function decodedJsonSetting<S extends Schema.Codec<unknown, unknown>>(
  setting: string,
  text: string,
  schema: S,
): Result.Result<S['Type'], readonly SettingProblem[]> {
  const decode = Schema.decodeUnknownResult(schema, strictly);
  return Result.flatMap(parsedJson(setting, text), (parsed) =>
    Result.mapError(decode(parsed), ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue).issues.map(({ message, path = [] }) =>
        problem(setting, pointerOf(path.filter((segment) => isPropertyKey(segment))), message),
      ),
    ),
  );
}
