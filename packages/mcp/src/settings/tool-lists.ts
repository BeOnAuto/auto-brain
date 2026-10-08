import { decodedJsonSetting, problem, type SettingProblem } from '@beonauto/config';
import { Result } from 'effect';

import {
  isAllowed,
  namesEveryTool,
  toolReferenceOf,
  toolReferenceShape,
  type ToolReference,
} from '../names/tool-reference.ts';
import { AllowedToolsSchema, TestableToolsSchema } from './server-entries.ts';

export const allowedToolsSetting = 'ALLOWED_TOOLS';

export const testableToolsSetting = 'TESTABLE_TOOLS';

type FurtherProblem = (reference: ToolReference, written: string) => string | undefined;

interface ToolList {
  readonly setting: string;
  readonly schema: typeof AllowedToolsSchema;
  readonly leftOut: string;
  readonly furtherProblem: FurtherProblem;
}

function noFurtherProblem(): undefined {
  return undefined;
}

function writtenProblem(list: ToolList, servers: readonly string[], written: readonly string[], index: number) {
  const each = String(written[index]);
  const reference = toolReferenceOf(each);
  if (reference === undefined) {
    return `Expected ${toolReferenceShape}`;
  }
  if (written.indexOf(each) < index) {
    return `${each} is listed twice`;
  }
  return servers.includes(reference.server)
    ? list.furtherProblem(reference, each)
    : `There is no MCP server named ${reference.server}`;
}

function referencesOf(
  list: ToolList,
  written: readonly string[],
  servers: readonly string[],
): Result.Result<readonly ToolReference[], readonly SettingProblem[]> {
  if (written.length === 0) {
    return Result.fail([
      problem(list.setting, '', `Expected at least one tool; leave ${list.setting} out ${list.leftOut}`),
    ]);
  }
  const problems = written.flatMap((_each, index) => {
    const detail = writtenProblem(list, servers, written, index);
    return detail === undefined ? [] : [problem(list.setting, `/${index}`, detail)];
  });
  return problems.length > 0
    ? Result.fail(problems)
    : Result.succeed(written.flatMap((each) => [toolReferenceOf(each)].filter((reference) => reference !== undefined)));
}

function toolListOf(
  list: ToolList,
  text: string | undefined,
  servers: readonly string[],
): Result.Result<readonly ToolReference[] | null, readonly SettingProblem[]> {
  return text === undefined
    ? Result.succeed(null)
    : Result.flatMap(decodedJsonSetting(list.setting, text, list.schema), (written) =>
        referencesOf(list, written, servers),
      );
}

export function allowedToolsOf(
  text: string | undefined,
  servers: readonly string[],
): Result.Result<readonly ToolReference[] | null, readonly SettingProblem[]> {
  return toolListOf(
    {
      setting: allowedToolsSetting,
      schema: AllowedToolsSchema,
      leftOut: 'to allow every tool',
      furtherProblem: noFurtherProblem,
    },
    text,
    servers,
  );
}

function untestableIn(allowed: readonly ToolReference[] | null): FurtherProblem {
  return (reference, written) => {
    if (namesEveryTool(reference)) {
      return `${written} would vouch for every tool of the server, those it adds later among them; name each tool that is safe to test`;
    }
    return isAllowed(reference, allowed)
      ? undefined
      : `${allowedToolsSetting} does not allow ${written}, and a tool a function may not call cannot be tested either`;
  };
}

export function testableToolsOf(
  text: string | undefined,
  servers: readonly string[],
  allowed: readonly ToolReference[] | null,
): Result.Result<readonly ToolReference[], readonly SettingProblem[]> {
  const testable = toolListOf(
    {
      setting: testableToolsSetting,
      schema: TestableToolsSchema,
      leftOut: 'to test only the tools their servers mark read-only',
      furtherProblem: untestableIn(allowed),
    },
    text,
    servers,
  );
  return Result.map(testable, (references) => references ?? []);
}
