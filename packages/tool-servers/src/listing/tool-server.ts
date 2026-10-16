import { Schema } from 'effect';

import type { ToolAnnotations } from '../bounds/tool-results.ts';
import type { ServerType } from '../settings/server-settings.ts';

export const UnavailableBecauseSchema = Schema.Literals([
  'failing',
  'rate_limited',
  'unreachable',
  'key_refused',
  'connection_pending',
  'connection_broken',
  'connection_not_allowed',
]);

export type UnavailableBecause = typeof UnavailableBecauseSchema.Type;

export interface ServerTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Schema.JsonObject;
  readonly annotations?: ToolAnnotations;
}

export interface ServerFields {
  readonly name: string;
  readonly type: ServerType;
  readonly record_content: boolean;
  readonly playbooks: readonly string[];
  readonly connection?: string;
}

export interface AvailableServer extends ServerFields {
  readonly tools: readonly ServerTool[];
}

export interface UnavailableServer extends ServerFields {
  readonly unavailable: string;
  readonly because: UnavailableBecause;
}

export type ToolServer = AvailableServer | UnavailableServer;
