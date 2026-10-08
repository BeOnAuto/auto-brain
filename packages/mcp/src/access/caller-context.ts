import type { CallJournal } from '../calls/recorded-calls.ts';
import type { McpServerFailed } from './mcp-server-failed.ts';
import type { ToolNotOffered } from './tool-not-offered.ts';

export interface CallerContext {
  readonly id: string;
  readonly org: string;
  readonly brain: string;
  readonly journal: CallJournal;
  readonly meta: Readonly<Record<string, string>>;
}

export interface ServerMessage {
  readonly server: string;
  readonly message: string;
  readonly execution_id: string | null;
  readonly tool_test_id: string | null;
}

export type ToolsNotOpened = ToolNotOffered | McpServerFailed;
