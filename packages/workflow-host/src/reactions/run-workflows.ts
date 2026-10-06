import { runStartedOf } from '@beonauto/specs';
import { Effect } from 'effect';

export type WorkflowOfRun = (brainKey: string, executionId: string) => Effect.Effect<string | undefined>;

export type ReadStream = (stream: string) => Promise<{ readonly events: readonly unknown[] }>;

const mostRunsRemembered = 4096;

export function workflowsOfRuns(
  read: ReadStream,
  primitive: string,
  mostRemembered = mostRunsRemembered,
): WorkflowOfRun {
  const remembered = new Map<string, string | undefined>();
  const workflowOf = (events: readonly unknown[]): string | undefined => {
    const started = runStartedOf(events[0]);
    return started?.primitive === primitive ? started.name : undefined;
  };
  return (brainKey, executionId) => {
    const stream = `${brainKey}executions/${executionId}`;
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
