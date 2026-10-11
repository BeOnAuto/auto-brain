import { runStartedOf } from '@beonauto/definitions';
import { Effect } from 'effect';

export type WorkflowOfRun = (playbookKey: string, runId: string) => Effect.Effect<string | undefined>;

export type ReadStream = (stream: string) => Promise<{ readonly events: readonly unknown[] }>;

const mostRunsRemembered = 4096;

export function workflowsOfRuns(read: ReadStream, type: string, mostRemembered = mostRunsRemembered): WorkflowOfRun {
  const remembered = new Map<string, string | undefined>();
  const workflowOf = (events: readonly unknown[]): string | undefined => {
    const started = runStartedOf(events[0]);
    return started?.definitionType === type ? started.name : undefined;
  };
  return (playbookKey, runId) => {
    const stream = `${playbookKey}runs/${runId}`;
    if (remembered.has(stream)) {
      return Effect.succeed(remembered.get(stream));
    }
    return Effect.promise(() => read(stream)).pipe(
      Effect.map(({ events }) => {
        const workflow = workflowOf(events);
        if (remembered.size >= mostRemembered) {
          remembered.clear();
        }
        remembered.set(stream, workflow);
        return workflow;
      }),
    );
  };
}
