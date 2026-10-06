import { Result } from 'effect';

import { toolReferenceOf, toolReferenceShape, type ToolReference } from '../names/tool-reference.ts';
import { decodedJsonSetting, problem } from './json-setting.ts';
import type { SettingProblem } from './mcp-settings.ts';
import { AllowedToolsSchema } from './server-entries.ts';

export const allowedToolsSetting = 'ALLOWED_TOOLS';

function writtenProblem(written: string, index: number, all: readonly string[], servers: readonly string[]) {
  const reference = toolReferenceOf(written);
  if (reference === undefined) {
    return `Expected ${toolReferenceShape}`;
  }
  if (all.indexOf(written) < index) {
    return `${written} is listed twice`;
  }
  return servers.includes(reference.server) ? undefined : `There is no MCP server named ${reference.server}`;
}

function referencesOf(
  written: readonly string[],
  servers: readonly string[],
): Result.Result<readonly ToolReference[], readonly SettingProblem[]> {
  if (written.length === 0) {
    return Result.fail([
      problem(
        allowedToolsSetting,
        '',
        `Expected at least one tool; leave ${allowedToolsSetting} out to allow every tool`,
      ),
    ]);
  }
  const problems = written.flatMap((each, index) => {
    const detail = writtenProblem(each, index, written, servers);
    return detail === undefined ? [] : [problem(allowedToolsSetting, `/${index}`, detail)];
  });
  return problems.length > 0
    ? Result.fail(problems)
    : Result.succeed(written.flatMap((each) => [toolReferenceOf(each)].filter((reference) => reference !== undefined)));
}

export function allowedToolsOf(
  text: string | undefined,
  servers: readonly string[],
): Result.Result<readonly ToolReference[] | null, readonly SettingProblem[]> {
  return text === undefined
    ? Result.succeed(null)
    : Result.flatMap(decodedJsonSetting(allowedToolsSetting, text, AllowedToolsSchema), (written) =>
        referencesOf(written, servers),
      );
}
