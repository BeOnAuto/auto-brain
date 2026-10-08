import { fileURLToPath } from 'node:url';

import { defaultTiming, type Timing } from '../bounds/call-bounds.ts';

export { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer, type SeenRequest } from './fake-mcp-server.ts';
export type { ClientRegistration } from './fake-authorization.ts';
export {
  deniedText,
  fakeChannels,
  fakeRequestIdKey,
  fakeToolNames,
  longToolName,
  verboseDescription,
  type ReceivedCall,
} from './fake-tools.ts';
export { fetchWithDeletion } from './deleting-fetch.ts';
export { fakeApiKey, openFakeToolRun, type FakeToolRun } from './fake-tool-run.ts';
export { recordingTimer, type RecordingTimer, type Wait } from './recording-timer.ts';
export { toolTester, toolTests, type TestAsking, type ToolTests, type ToolTestsOptions } from './tool-test-runs.ts';
export { reportingAccess, type AccessOptions, type ReportingAccess } from './reporting-access.ts';
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

export const stdioTestTimeoutMs = 30_000;

export const patientTiming: Timing = { ...defaultTiming, callMs: 20_000, openMs: 20_000 };
