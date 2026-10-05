import type { McpServerFailed } from './mcp-server-failed.ts';
import type { CallJournal } from './recorded-calls.ts';
import type { ToolNotOffered } from './tool-not-offered.ts';

export interface RunContext {
  readonly id: string;
  readonly org: string;
  readonly brain: string;
  readonly journal: CallJournal;
}

export interface ServerMessage {
  readonly server: string;
  readonly message: string;
  readonly execution_id: string | null;
}

export type ToolsNotOpened = ToolNotOffered | McpServerFailed;
