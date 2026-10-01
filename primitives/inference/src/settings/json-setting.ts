import { Result, SchemaIssue, type Schema, type StandardSchema } from 'effect';

import { pointerOf } from '../schema/json-bounds.ts';
import { problem, type SettingProblem } from './setting-values.ts';

type IssueSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

export type SettingDecoder<A> = (input: unknown) => Result.Result<A, Schema.SchemaError>;

export const strictly = { onExcessProperty: 'error', errors: 'all' } as const;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function isPropertyKey(segment: IssueSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function parsedJson(setting: string, text: string): Result.Result<unknown, readonly SettingProblem[]> {
  try {
    const parsed: unknown = JSON.parse(text);
    return Result.succeed(parsed);
  } catch {
    return Result.fail(problem(setting, 'Expected JSON'));
  }
}

function placeOf(path: readonly IssueSegment[]): string {
  const pointer = pointerOf(path.filter((segment) => isPropertyKey(segment)));
  return pointer === '' ? '/' : pointer;
}

function problemsOf(
  setting: string,
  issues: readonly StandardSchema.StandardSchemaV1.Issue[],
): readonly SettingProblem[] {
  return issues.map(({ message, path = [] }) => ({ setting, detail: `${placeOf(path)}: ${message}` }));
}

export function decodeJsonSetting<A>(
  setting: string,
  text: string,
  decode: SettingDecoder<A>,
): Result.Result<A, readonly SettingProblem[]> {
  return Result.flatMap(parsedJson(setting, text), (parsed) =>
    Result.mapError(decode(parsed), ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      problemsOf(setting, formatIssues(issue).issues),
    ),
  );
}
