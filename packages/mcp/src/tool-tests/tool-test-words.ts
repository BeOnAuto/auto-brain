import { quoted, type Remedies } from '@beonauto/operations';

import { toolBounds } from '../bounds/call-bounds.ts';
import { serverFailedText } from '../calls/call-replies.ts';

export interface TestAsked {
  readonly server: string;
  readonly tool: string;
}

export type TestedOutcome = 'result' | 'tool_error' | 'server_failure' | 'timed_out';

export interface TestAnswer extends TestAsked {
  readonly outcome: TestedOutcome;
  readonly text: string;
  readonly result_bytes: number | null;
  readonly duration_ms: number;
}

const measured = new Intl.NumberFormat('en');

export const toolTestTask = 'test a tool of a tool server';

export function toolTestAttempted({ server, tool }: TestAsked): string {
  return `test the tool ${quoted(tool)} of ${quoted(server)}`;
}

export const toolTestRemedies: Remedies = {
  mcp_server_not_configured:
    'This can be put right on your side: list_tool_servers shows the tool servers this brain may use, so a test that names one of those can be tried.',
  tool_not_allowed:
    'This can be put right on your side: list_tool_servers shows the tools this brain may use, which whoever runs the server allows, so a test that names one of those can be tried.',
  tool_not_listed:
    'This can be put right on your side: list_tool_servers shows the tools each tool server has, so a test that names one of those can be tried.',
};

function bytesInWords(bytes: number | null): string {
  return bytes === null ? 'nothing' : `${measured.format(bytes)} bytes`;
}

function failureOf({ server, text }: TestAnswer): string {
  return text.replace(serverFailedText(server, ''), '').replace(/\.$/u, '');
}

const wordsOf: Readonly<Record<TestedOutcome, (answer: TestAnswer) => string>> = {
  result: (answer) =>
    `The tool ${quoted(answer.tool)} of ${quoted(answer.server)} answered in ${measured.format(answer.duration_ms)} ms with ${bytesInWords(answer.result_bytes)}; what a reasoning function's model would see is in the details.`,
  tool_error: (answer) =>
    `The tool ${quoted(answer.tool)} of ${quoted(answer.server)} answered an error, as a run's model would see it; the details show what it said.`,
  server_failure: (answer) =>
    `The tool server ${quoted(answer.server)} failed to answer the test: ${failureOf(answer)}. It may or may not have received the call.`,
  timed_out: (answer) =>
    `The tool server ${quoted(answer.server)} did not answer the test within ${measured.format(toolBounds.callMs / 1000)} seconds; it may still have received the call.`,
};

export function toolTested(answer: TestAnswer): string {
  return wordsOf[answer.outcome](answer);
}
