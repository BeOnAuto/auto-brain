import { streamPrefixOfBrain } from '@beonauto/operations';

export interface RunAddress {
  readonly org: string;
  readonly brain: string;
  readonly executionId: string;
}

export function runIdOf({ org, brain, executionId }: RunAddress): string {
  return `${org}/${brain}/${executionId}`;
}

export function addressOfRun(runId: string): RunAddress {
  const afterOrg = runId.indexOf('/') + 1;
  const afterBrain = runId.indexOf('/', afterOrg) + 1;
  return {
    org: runId.slice(0, afterOrg - 1),
    brain: runId.slice(afterOrg, afterBrain - 1),
    executionId: runId.slice(afterBrain),
  };
}

export function streamOfRun(runId: string): string {
  const address = addressOfRun(runId);
  return `${streamPrefixOfBrain(address)}runs/${address.executionId}`;
}
