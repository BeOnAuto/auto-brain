import { streamPrefixOfBrain } from '@beonauto/operations';

export interface RunAddress {
  readonly org: string;
  readonly brain: string;
  readonly runId: string;
}

export function runKeyOf({ org, brain, runId }: RunAddress): string {
  return `${org}/${brain}/${runId}`;
}

export function addressOfRun(runKey: string): RunAddress {
  const afterOrg = runKey.indexOf('/') + 1;
  const afterBrain = runKey.indexOf('/', afterOrg) + 1;
  return {
    org: runKey.slice(0, afterOrg - 1),
    brain: runKey.slice(afterOrg, afterBrain - 1),
    runId: runKey.slice(afterBrain),
  };
}

export function runLogStreamOf(runKey: string): string {
  const address = addressOfRun(runKey);
  return `${streamPrefixOfBrain(address)}run-logs/${address.runId}`;
}
