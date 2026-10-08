import type { Schema } from 'effect';

import type { CallsEndedBecause } from '../access/mcp-server-failed.ts';
import { callsEnded, cutToDescriptionBound, noCalls } from '../bounds/call-bounds.ts';
import { modelFacingNames } from '../names/model-facing-names.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { toolsInWords } from '../names/tool-words.ts';
import type { CallReply } from './call-replies.ts';
import type { CallSignals, RunState, RunToolsParts, ToolCallRequest } from './run-parts.ts';
import { caller } from './tool-caller.ts';

export interface OfferedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.JsonObject;
  readonly call: (request: ToolCallRequest, signals: CallSignals) => Promise<CallReply>;
}

export interface ToolsEnding {
  readonly because: CallsEndedBecause;
}

export interface RunTools {
  readonly offered: readonly OfferedTool[];
  readonly callsEnded: () => boolean;
  readonly ended: Readonly<AbortSignal>;
  readonly ending: () => ToolsEnding | undefined;
  readonly calledAny: () => boolean;
  readonly usedInWords: () => string;
  readonly close: () => Promise<void>;
}

export function runTools(parts: RunToolsParts): RunTools {
  let tally = noCalls;
  let ending: ToolsEnding | undefined;
  const used: ToolReference[] = [];
  const stop = new AbortController();
  const state: RunState = {
    tally: () => tally,
    tallied: (next) => {
      tally = next;
    },
    used: (reference) => {
      used.push(reference);
    },
    ended: (because) => {
      ending ??= { because };
      stop.abort();
    },
  };
  const offered = modelFacingNames(parts.offered).map((tool): OfferedTool => ({
    name: tool.name,
    description: cutToDescriptionBound(tool.tool.description ?? ''),
    inputSchema: tool.tool.inputSchema,
    call: caller(parts, state, tool),
  }));
  return {
    offered,
    callsEnded: () => callsEnded(tally),
    ended: stop.signal,
    ending: () => ending,
    calledAny: () => used.length > 0,
    usedInWords: () => toolsInWords(used),
    close: async () => {
      await Promise.all(parts.slots.map((slot) => slot.release()));
    },
  };
}
