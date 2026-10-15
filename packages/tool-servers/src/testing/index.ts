import { fileURLToPath } from 'node:url';

import { defaultTiming, type Timing } from '../bounds/call-bounds.ts';

export { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer, type SeenRequest } from './fake-mcp-server.ts';
export { serveFakeApi, type FakeApiOptions, type FakeApiServer } from '../api-testing/fake-api-server.ts';
export type { SeenApiRequest } from '../api-testing/fake-api-routes.ts';
export { fakeApiDocument, fakeApiToolNames, type FakeApiVersion } from '../api-testing/fake-api-document.ts';
export { chatBot, type ChatMessage, type ChatReply, type FakeChat } from './fake-chat.ts';
export type { ClientRegistration } from './fake-authorization.ts';
export {
  deniedText,
  fakeChannels,
  fakeRequestIdKey,
  fakeToolNames,
  longToolName,
  verboseDescription,
  type FakeHints,
  type ReceivedCall,
} from './fake-tools.ts';
export { brokenPromise, threadReplies } from './fake-data-tools.ts';
export { fetchWithDeletion } from './deleting-fetch.ts';
export { fakeApiKey, openFakeToolRun, type FakeToolRun } from './fake-tool-run.ts';
export { recordingTimer, type RecordingTimer, type Wait } from './recording-timer.ts';
export {
  playbookToolCalls,
  toolCaller,
  toolReader,
  type Asking,
  type PlaybookTool,
  type PlaybookToolCalls,
  type WritesOptions,
} from './playbook-tool-calls.ts';
export {
  describedAccess,
  noToolServers,
  reportingAccess,
  testClientInfo,
  type AccessOptions,
  type ReportingAccess,
} from './reporting-access.ts';
export {
  controlledSignals,
  inTurn,
  recordingCallJournal,
  toolRun,
  toolRunId,
  type ControlledSignals,
  type RecordingCallJournal,
} from './tool-runs.ts';

export const fakeStdioServerPath = fileURLToPath(new URL('./fake-stdio-server.ts', import.meta.url));

export const patientTiming: Timing = { ...defaultTiming, callMs: 20_000, openMs: 20_000 };
