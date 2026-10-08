import { Unavailable } from '@beonauto/operations';
import { DateTime, Effect, Schema } from 'effect';

import type { ToolsNotOpened } from '../access/caller-context.ts';
import type { CallReply } from '../calls/call-replies.ts';
import type { OfferedTool, RunTools } from '../calls/run-tools.ts';
import { ignored } from '../connections/ignored.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { canBeTested, type TestingLists } from './testing-guard.ts';
import { TestedOutcomeSchema } from './tool-test-schemas.ts';
import type { TestedOutcome } from './tool-test-words.ts';

export interface Tested {
  readonly reference: ToolReference;
  readonly testId: string;
  readonly input: Schema.JsonObject;
}

export interface Calling {
  readonly testedAt: string;
  readonly replying: Promise<CallReply>;
  readonly stop: AbortController;
}

const isTestedOutcome = Schema.is(TestedOutcomeSchema);

export function unavailableOf({ _tag: kind, because, detail }: Pick<ToolsNotOpened, '_tag' | 'because' | 'detail'>) {
  return new Unavailable({ detail, kind, because });
}

function notTestable({ server, tool }: ToolReference): Unavailable {
  return new Unavailable({
    detail: `The MCP server ${server} does not mark the tool ${tool} read-only, and the operator of this server does not list it in testable_tools`,
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

export function testedOutcomeOf({ outcome }: CallReply): Effect.Effect<TestedOutcome> {
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
  const answering = offered.call({ callId: testId, input }, { signal: stop.signal, cancelled: stop.signal });
  const replying = closedOnceAnswered(tools, answering);
  replying.catch(ignored);
  return { testedAt, replying, stop };
}

export function stopped({ stop }: Calling): Effect.Effect<void> {
  return Effect.sync(() => {
    stop.abort();
  });
}

export const calledWhenTestable = Effect.fnUntraced(function* (testing: TestingLists, tools: RunTools, tested: Tested) {
  const [offered] = tools.offered;
  const { reference } = tested;
  if (offered === undefined || !canBeTested(reference, offered.annotations, testing)) {
    yield* Effect.promise(() => tools.close());
    return yield* Effect.fail(offered === undefined ? notListed(reference) : notTestable(reference));
  }
  const testedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.sync(() => startedCall(tools, offered, tested, testedAt));
});
