import type { Schema } from 'effect';

import type { CallsEndedBecause } from '../access/mcp-server-failed.ts';
import { callsEnded, cutToDescriptionBound, noCalls } from '../bounds/call-bounds.ts';
import { isReadOnly, type ToolAnnotations } from '../bounds/tool-results.ts';
import { modelFacingNames } from '../names/model-facing-names.ts';
import { toolsInWords } from '../names/tool-words.ts';
import type { CallReply } from './call-replies.ts';
import type { CallSignals, OfferedOnServer, RunState, RunToolsParts, ToolCallRequest } from './run-parts.ts';
import { caller } from './tool-caller.ts';

export interface OfferedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.JsonObject;
  readonly annotations: ToolAnnotations | undefined;
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
  readonly calledOnlyReadOnly: () => boolean;
  readonly usedInWords: () => string;
  readonly close: () => Promise<void>;
}

export function runTools(parts: RunToolsParts): RunTools {
  let tally = noCalls;
  let ending: ToolsEnding | undefined;
  const used: OfferedOnServer[] = [];
  const stop = new AbortController();
  const state: RunState = {
    tally: () => tally,
    tallied: (next) => {
      tally = next;
    },
    used: (offer) => {
      used.push(offer);
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
    annotations: tool.tool.annotations,
    call: caller(parts, state, tool),
  }));
  return {
    offered,
    callsEnded: () => callsEnded(tally),
    ended: stop.signal,
    ending: () => ending,
    calledAny: () => used.length > 0,
    calledOnlyReadOnly: () => used.every(({ tool }) => isReadOnly(tool.annotations)),
    usedInWords: () => toolsInWords(used.map(({ reference }) => reference)),
    close: async () => {
      await Promise.all(parts.slots.map((slot) => slot.release()));
    },
  };
}
