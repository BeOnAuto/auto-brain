import { BrainContext, Unavailable, defineCommand, randomUUIDv7 } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ToolsNotOpened } from '../access/caller-context.ts';
import type { ToolAccess } from '../access/tool-access.ts';
import { cutToFailureBound } from '../bounds/call-bounds.ts';
import { toolTestIdKey } from '../calls/call-meta.ts';
import { calledWhenTestable, stopped, testedOutcomeOf } from './test-calling.ts';
import { toolTestJournal } from './tool-test-journal.ts';
import { TestToolCallInputSchema, ToolTestedSchema } from './tool-test-schemas.ts';
import { toolTestAttempted, toolTestTask, toolTested } from './tool-test-words.ts';

const description = [
  "Calls one tool of a tool server with the arguments it is given, as a run of a reasoning function would call it, and answers what that run's model would see.",
  "Use it to learn what a tool answers before a function names it, to find an id a prompt needs, such as a channel's, or to check that a server answers, in place of a function made to look.",
  'Only a tool its server marks read-only, or that whoever runs this server lists as safe to test, can be tested, and list_tool_servers says which.',
  '`server` and `tool` name the tool as list_tool_servers lists it, and `arguments` is the object its input_schema takes.',
  "The call is recorded in the brain's history, with its content where the server's entry records it, and it is live: a tool listed as safe to test may still change something.",
].join(' ');

function unavailableOf({ _tag: kind, because, detail }: Pick<ToolsNotOpened, '_tag' | 'because' | 'detail'>) {
  return new Unavailable({ detail: cutToFailureBound(detail), kind, because });
}

export function defineTestToolCall(access: Pick<ToolAccess, 'open' | 'testing'>) {
  return defineCommand('brain', {
    name: 'test_tool_call',
    title: 'Test a tool call',
    description,
    route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/test' },
    reachesOutside: true,
    mayChangeOutside: access.testing.testable.length > 0,
    inputSchema: TestToolCallInputSchema,
    outputSchema: ToolTestedSchema,
    reasons: ['invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ server, tool, arguments: input = {} }) {
      const { org, brain } = yield* BrainContext;
      const testId = randomUUIDv7();
      const journal = yield* toolTestJournal(testId);
      const context = { id: testId, org, brain, journal, meta: { [toolTestIdKey]: testId } };
      const tested = { reference: { server, tool }, testId, input };
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const tools = yield* restore(access.open(context, [tested.reference])).pipe(Effect.mapError(unavailableOf));
          const calling = yield* calledWhenTestable(access.testing, tools, tested);
          const reply = yield* restore(Effect.promise(() => calling.replying)).pipe(
            Effect.onInterrupt(() => stopped(calling)),
          );
          return {
            test_id: testId,
            server,
            tool,
            outcome: yield* testedOutcomeOf(reply),
            text: reply.text,
            result_bytes: reply.resultBytes,
            duration_ms: reply.durationMs,
            ...(reply.serverRequestId === null ? {} : { server_request_id: reply.serverRequestId }),
            tested_at: calling.testedAt,
          };
        }),
      );
    }),
    plainLanguage: {
      task: toolTestTask,
      attempt: (asked) => toolTestAttempted(asked),
      outcome: (answer) => toolTested(answer),
    },
  });
}
