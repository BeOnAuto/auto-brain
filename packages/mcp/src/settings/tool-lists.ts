import { pointerOf, problem, type SettingProblem } from '@beonauto/config';
import { Result } from 'effect';

import { isToolName } from '../names/tool-reference.ts';
import type { ToolLists } from './mcp-settings.ts';
import { mcpServersSetting, type McpServerEntryFields } from './server-entries.ts';

type Checked<A> = Result.Result<A, readonly SettingProblem[]>;

type Outside = (tool: string) => string | undefined;

interface ToolList {
  readonly field: 'allowed' | 'testable';
  readonly leftOut: string;
  readonly everyTool: string;
}

const everyTool = '*';

const allowedList: ToolList = {
  field: 'allowed',
  leftOut: 'leave allowed out to allow every tool',
  everyTool: 'Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out',
};

const testableList: ToolList = {
  field: 'testable',
  leftOut: 'leave testable out to test only the tools the server marks read-only',
  everyTool:
    '* would vouch for every tool of the server, those it adds later among them; name each tool that is safe to test',
};

function namedProblem(list: ToolList, written: readonly string[], tool: string, index: number): string | undefined {
  if (tool === everyTool) {
    return list.everyTool;
  }
  if (!isToolName(tool)) {
    return 'Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots';
  }
  return written.indexOf(tool) < index ? `${tool} is listed twice` : undefined;
}

function listOf(
  server: string,
  list: ToolList,
  written: readonly string[] | undefined,
  outside: Outside,
): Checked<readonly string[] | null> {
  if (written === undefined) {
    return Result.succeed(null);
  }
  const place = (...path: readonly string[]) => pointerOf([server, list.field, ...path]);
  if (written.length === 0) {
    return Result.fail([problem(mcpServersSetting, place(), `Expected at least one tool; ${list.leftOut}`)]);
  }
  const problems = written.flatMap((tool, index) => {
    const detail = namedProblem(list, written, tool, index) ?? outside(tool);
    return detail === undefined ? [] : [problem(mcpServersSetting, place(String(index)), detail)];
  });
  return problems.length > 0 ? Result.fail(problems) : Result.succeed(written);
}

function insideEveryList(): undefined {
  return undefined;
}

function outsideOf(allowed: readonly string[] | null): Outside {
  return (tool) =>
    allowed === null || allowed.includes(tool)
      ? undefined
      : `allowed does not name ${tool}, and a tool a function may not call cannot be tested either`;
}

export function toolListsOf(server: string, { allowed, testable }: McpServerEntryFields): Checked<ToolLists> {
  const allowedTools = listOf(server, allowedList, allowed, insideEveryList);
  const testableTools = listOf(server, testableList, testable, outsideOf(Result.getOrElse(allowedTools, () => null)));
  if (Result.isSuccess(allowedTools) && Result.isSuccess(testableTools)) {
    return Result.succeed({ allowed: allowedTools.success, testable: testableTools.success ?? [] });
  }
  return Result.fail([
    ...(Result.isFailure(allowedTools) ? allowedTools.failure : []),
    ...(Result.isFailure(testableTools) ? testableTools.failure : []),
  ]);
}
