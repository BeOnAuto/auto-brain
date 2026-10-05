import { fileURLToPath } from 'node:url';

export { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer, type SeenRequest } from './fake-mcp-server.ts';
export type { ClientRegistration } from './fake-authorization.ts';
export { deniedText, fakeRequestIdKey, fakeToolNames, longToolName, type ReceivedCall } from './fake-tools.ts';
export { fakeApiKey, openFakeToolRun, type FakeToolRun } from './fake-tool-run.ts';
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
