import { Schema } from 'effect';

import type { ServerFailedBecause } from '../access/tool-server-failed.ts';
import type { ToolAnnotations } from '../bounds/tool-results.ts';
import type { ServerType } from '../settings/server-settings.ts';

export const ServerFailedBecauseSchema = Schema.Literals(['failing', 'rate_limited', 'unreachable', 'key_refused']);

export interface ServerTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Schema.JsonObject;
  readonly annotations?: ToolAnnotations;
}

interface ServerFields {
  readonly name: string;
  readonly type: ServerType;
  readonly record_content: boolean;
}

export interface AvailableServer extends ServerFields {
  readonly tools: readonly ServerTool[];
}

export interface UnavailableServer extends ServerFields {
  readonly unavailable: string;
  readonly because: ServerFailedBecause;
}

export type ToolServer = AvailableServer | UnavailableServer;
