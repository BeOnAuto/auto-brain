import { Unavailable } from '@beonauto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import type { CallReply } from '../calls/call-replies.ts';
import type { OfferedTool, RunTools } from '../calls/run-tools.ts';
import { ignored } from '../connections/ignored.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { ServerToolLists } from '../settings/mcp-settings.ts';
import { canBeTested } from './testing-guard.ts';
import { TestedOutcomeSchema } from './tool-test-schemas.ts';

export interface Tested {
  readonly reference: ToolReference;
  readonly testId: string;
  readonly input: Schema.JsonObject;
}

export interface Calling {
  readonly testedAt: string;
  readonly answering: Promise<CallReply>;
  readonly replying: Promise<CallReply>;
  readonly stop: AbortController;
}

const isTestedOutcome = Schema.is(TestedOutcomeSchema);

function notTestable({ server, tool }: ToolReference): Unavailable {
  return new Unavailable({
    detail: `The MCP server ${server} does not mark the tool ${tool} read-only, and the operator of this server does not mark it testable`,
    kind: 'tool_not_offered',
    because: 'not_testable',
  });
}

function notListed({ server, tool }: ToolReference): Unavailable {
  return new Unavailable({
    detail: `The MCP server ${server} does not list the tool ${tool}`,
    kind: 'tool_not_offered',
    because: 'tool_not_listed',
  });
}

export function testedOutcomeOf({ outcome }: CallReply): Effect.Effect<typeof TestedOutcomeSchema.Type> {
  return isTestedOutcome(outcome)
    ? Effect.succeed(outcome)
    : Effect.die(new Error(`A test of a tool answered ${outcome}, which a test that was sent never answers`));
}

async function closedOnceAnswered(tools: RunTools, answering: Promise<CallReply>): Promise<CallReply> {
  try {
    return await answering;
  } finally {
    await tools.close();
  }
}

function startedCall(tools: RunTools, offered: OfferedTool, { testId, input }: Tested, testedAt: string): Calling {
  const stop = new AbortController();
  const answering = offered.call(
    { callId: testId, input, room: toolBounds.testedAnswerBytes },
    { signal: stop.signal, cancelled: stop.signal },
  );
  const replying = closedOnceAnswered(tools, answering);
  replying.catch(ignored);
  return { testedAt, answering, replying, stop };
}

export function stopped({ stop, answering }: Calling): Effect.Effect<void> {
  return Effect.sync(() => {
    stop.abort();
  }).pipe(Effect.andThen(Effect.promise(() => answering)), Effect.asVoid);
}

function isTestable(
  testing: readonly ServerToolLists[],
  { server, tool }: ToolReference,
  offered: OfferedTool,
): boolean {
  const lists = testing.find(({ name }) => name === server);
  return lists !== undefined && canBeTested(tool, offered.annotations, lists);
}

export const calledWhenTestable = Effect.fnUntraced(function* (
  testing: readonly ServerToolLists[],
  tools: RunTools,
  tested: Tested,
) {
  const [offered] = tools.offered;
  const { reference } = tested;
  if (offered === undefined || !isTestable(testing, reference, offered)) {
    yield* Effect.promise(() => tools.close());
    return yield* Effect.fail(offered === undefined ? notListed(reference) : notTestable(reference));
  }
  const testedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.sync(() => startedCall(tools, offered, tested, testedAt));
});
