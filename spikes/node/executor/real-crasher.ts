import { Effect } from 'effect';

import { openLedger } from '../../../packages/ledger/src/testing/open-ledger.ts';
import { runDecider, runStreamOf } from './run-stream.ts';

const [fileName = '', executionId = '', stepText = '0', timeoutText = '0'] = process.argv.slice(2);
const { ledger } = await openLedger(fileName);
const { version } = await Effect.runPromise(
  ledger.execute(runStreamOf(executionId), runDecider, {
    executionId,
    messageId: `start:${executionId}`,
    at: Date.now(),
    input: { kind: 'start', stepMs: Number(stepText), timeoutMs: Number(timeoutText) },
  }),
);
console.log(`appended ${version}`);
setInterval(() => {}, 60_000);
