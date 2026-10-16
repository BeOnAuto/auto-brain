import {
  CLIENT_CAPABILITIES_META_KEY,
  createRequestStateCodec,
  inputRequired,
  type CallToolResult,
  type InputRequiredResult,
  type RequestStateCodec,
} from '@modelcontextprotocol/server';
import type { LinkToOpen } from '@on.auto/operations';
import { Option, Redacted, Schema } from 'effect';

import { orgCallOf, type OrgCall } from '../hand-off/caller-hand-off.ts';
import { callbackFor, type CalledTool, type CallServing, type ToolContext } from './tool-callback.ts';

interface StateMinting {
  mint(payload: Readonly<Record<string, unknown>>, context?: ToolContext): Promise<string>;
}

export interface LinkedAnswers {
  readonly states: RequestStateCodec;
  readonly minting: StateMinting;
}

export interface AnsweringServing extends CallServing {
  readonly linkedAnswers: LinkedAnswers;
}

interface LinkingTool extends CalledTool {
  readonly linkToOpen?: (output: unknown) => LinkToOpen;
}

interface AnswerOwner {
  readonly tool: string;
  readonly caller: string;
  readonly org: string;
}

type Answering = (input: unknown, context: ToolContext) => Promise<CallToolResult>;

type AskingToOpen = (input: unknown, context: ToolContext) => Promise<CallToolResult | InputRequiredResult>;

const theLink = 'link';

const OpensLinksSchema = Schema.Struct({
  [CLIENT_CAPABILITIES_META_KEY]: Schema.Struct({
    elicitation: Schema.Struct({ url: Schema.Record(Schema.String, Schema.Unknown) }),
  }),
});

const KeptAnswerSchema = Schema.Struct({
  tool: Schema.String,
  caller: Schema.String,
  org: Schema.String,
  answer: Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
    structuredContent: Schema.Record(Schema.String, Schema.Unknown),
  }),
});

const BoundContextSchema = Schema.Struct({
  http: Schema.Struct({ authInfo: Schema.Struct({ extra: Schema.Record(Schema.String, Schema.Unknown) }) }),
});

const opensLinks = Schema.is(OpensLinksSchema);

const boundContextOf = Schema.decodeUnknownSync(BoundContextSchema);

const keptAnswerOf = Schema.decodeUnknownOption(KeptAnswerSchema);

function callerAndOrgOf(context: unknown): string {
  const { caller, org } = orgCallOf(boundContextOf(context).http);
  return JSON.stringify([caller.id, org]);
}

export type RetryStateKey = Redacted.Redacted<Uint8Array>;

export function linkedAnswers(stateKey: RetryStateKey): LinkedAnswers {
  const codec = createRequestStateCodec({ key: Redacted.value(stateKey), bind: callerAndOrgOf });
  return { states: codec, minting: codec };
}

function keptAnswerFor({ tool, caller, org }: AnswerOwner, state: unknown): CallToolResult | undefined {
  return Option.getOrUndefined(
    Option.flatMap(keptAnswerOf(state), (kept) =>
      kept.tool === tool && kept.caller === caller && kept.org === org
        ? Option.some({
            content: kept.answer.content.map(({ text }) => ({ type: 'text' as const, text })),
            structuredContent: { ...kept.answer.structuredContent },
          })
        : Option.none(),
    ),
  );
}

function askingToOpen(
  { minting }: LinkedAnswers,
  owner: AnswerOwner,
  linkOf: (output: unknown) => LinkToOpen,
  answering: Answering,
): AskingToOpen {
  return async (input, context) => {
    const kept = keptAnswerFor(owner, context.mcpReq.requestState());
    if (kept !== undefined) {
      return kept;
    }
    const answer = await answering(input, context);
    const output = answer.structuredContent;
    if (output === undefined || !opensLinks(context.mcpReq.envelope)) {
      return answer;
    }
    const { message, url } = linkOf(output);
    return inputRequired({
      inputRequests: { [theLink]: inputRequired.elicitUrl({ message, url }) },
      requestState: await minting.mint({ ...owner, answer }, context),
    });
  };
}

export function toolCallbackOf(serving: AnsweringServing, call: OrgCall, tool: LinkingTool): AskingToOpen {
  const answering = callbackFor(serving, call, tool);
  const owner = { tool: tool.name, caller: call.caller.id, org: call.org };
  return tool.linkToOpen === undefined
    ? answering
    : askingToOpen(serving.linkedAnswers, owner, tool.linkToOpen, answering);
}
