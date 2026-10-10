function workerOf(lines: readonly string[]): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(lines.join('\n'))}`);
}

const answeringByThread = [
  "import { parentPort, threadId } from 'node:worker_threads';",
  'const listen = () => {',
  "  parentPort.on('message', ({ job, request }) => {",
  '    const issues = request.expressions.map((each, at) => ({ at, line: threadId, detail: each.source }));',
  "    parentPort.postMessage({ job, answer: { ran: 'checked', issues }, keep: true });",
  '  });',
  '  parentPort.postMessage({ ready: true });',
  '};',
];

export function checkingReadyAfter(milliseconds: number): URL {
  return workerOf([...answeringByThread, `setTimeout(listen, ${milliseconds});`]);
}

export const checking = workerOf([...answeringByThread, 'listen();']);

export const checkingForever = workerOf([
  "import { parentPort } from 'node:worker_threads';",
  "parentPort.on('message', () => {",
  '  for (;;) {}',
  '});',
  'parentPort.postMessage({ ready: true });',
]);

export const brokenAtStart = workerOf(["throw new Error('broken on purpose');"]);
