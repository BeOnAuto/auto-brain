import { Effect, Option } from 'effect';

import type { ServerMessage } from '../access/run-context.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import type { ToolReply } from '../calls/call-replies.ts';
import type { RunTools } from '../calls/run-tools.ts';
import { serveFakeMcp, type FakeMcpServer } from './fake-mcp-server.ts';
import { reportingAccess } from './reporting-access.ts';
import {
  controlledSignals,
  recordingCallJournal,
  toolRun,
  type ControlledSignals,
  type RecordingCallJournal,
} from './tool-runs.ts';

export const fakeApiKey = 'graph-api-key-4f1d9a7c2b';

export interface FakeToolRun {
  readonly fake: FakeMcpServer;
  readonly tools: RunTools;
  readonly journal: RecordingCallJournal;
  readonly messages: () => readonly ServerMessage[];
  readonly call: (
    tool: string,
    input: Readonly<Record<string, unknown>>,
    signals?: ControlledSignals,
  ) => Promise<ToolReply>;
  readonly close: () => Promise<void>;
}

export async function openFakeToolRun(tools: readonly string[], timing?: Timing): Promise<FakeToolRun> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  const { access, messages } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: fakeApiKey }, ...(timing === undefined ? {} : { timing }) },
  );
  const journal = recordingCallJournal();
  const references = tools.map((tool) => ({ server: 'graph', tool }));
  const opened = await Effect.runPromise(access.open(toolRun(journal), references));
  const byName = new Map(opened.offered.map((tool) => [tool.name, tool]));
  let calls = 0;
  return {
    fake,
    tools: opened,
    journal,
    messages,
    call: (tool, input, signals = controlledSignals()) => {
      calls += 1;
      const offered = Option.getOrThrow(Option.fromNullishOr(byName.get(`mcp__graph__${tool}`)));
      return offered.call({ callId: `call-${calls}`, input }, signals);
    },
    close: async () => {
      await opened.close();
      await access.close();
      await fake.close();
    },
  };
}
