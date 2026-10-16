import { setTimeout as delay } from 'node:timers/promises';

import { Schema } from 'effect';

import { answerGraceMs } from '../program-pool/evaluation-thread.ts';
import { nextThreadStarted } from './threads-alive.ts';

export interface Replaced<Answer> {
  readonly answer: Answer;
  readonly replacedAfterMs: number | undefined;
}

const asked = 'the requests evaluation workers are asked';

const decodeAsked = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.String }));

const evaluationLoop = new URL('../program-pool/evaluation-loop.ts', import.meta.url).href;

export const announcingEvaluations = new URL(
  `data:text/javascript,${encodeURIComponent(
    [
      "import { BroadcastChannel, workerData } from 'node:worker_threads';",
      `import { serveEvaluations } from '${evaluationLoop}';`,
      `const asked = new BroadcastChannel(${JSON.stringify(asked)});`,
      'asked.unref();',
      "workerData.port.on('message', (request) => { asked.postMessage({ kind: request.kind }); });",
      'serveEvaluations(workerData);',
    ].join('\n'),
  )}`,
);

function nextAsked(kind: string): Promise<void> {
  const listening = new BroadcastChannel(asked);
  const { promise, resolve } = Promise.withResolvers<void>();
  listening.addEventListener('message', (event: Readonly<MessageEvent>) => {
    if (decodeAsked(event.data).kind === kind) {
      listening.close();
      resolve();
    }
  });
  return promise;
}

export async function replacedByTheDeadlineOf<Answer>(
  kind: string,
  deadlineMs: number,
  work: () => Promise<Answer>,
): Promise<Replaced<Answer>> {
  const started = performance.now();
  const replaced: { afterMs?: number } = {};
  const replacing = nextThreadStarted().then((thread) => {
    replaced.afterMs = performance.now() - started;
    return thread;
  });
  const asking = nextAsked(kind);
  const working = work();
  await asking;
  await delay(deadlineMs + answerGraceMs + 1);
  const replacedAfterMs = replaced.afterMs;
  const answer = await working;
  await replacing;
  return { answer, replacedAfterMs };
}
