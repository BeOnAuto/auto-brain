function workerOf(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

const countingSource = [
  "import { pbkdf2Sync } from 'node:crypto';",
  "import { parentPort, threadId } from 'node:worker_threads';",
  'let jobs = 0;',
  'const answer = (job, keep) => {',
  '  const output = JSON.stringify({ jobs, thread: threadId });',
  "  parentPort.postMessage({ job, answer: { ran: 'answered', output, bytes: output.length, work: 0 }, keep });",
  '};',
  'const behaviours = {',
  '  block: () => { while (true) {} },',
  '  allocate: () => { const kept = []; while (true) { kept.push(new Array(100000).fill(jobs)); } },',
  "  crash: () => { throw new Error('broken on purpose'); },",
  "  'wrong job': (job) => answer(job + 1, true),",
  "  'let go': (job) => answer(job, false),",
  '  hold: (job) => { setTimeout(() => answer(job, true), 300); },',
  "  linger: (job) => { setTimeout(() => { answer(job, true); pbkdf2Sync('x', 'y', 10000000, 32, 'sha512'); }, 300); },",
  "  'then message': (job) => { answer(job, true); setTimeout(() => parentPort.postMessage('stray'), 50); },",
  "  'then throw': (job) => { answer(job, true); setTimeout(() => { throw new Error('idle and broken'); }, 50); },",
  "  'then exit': (job) => { answer(job, true); setTimeout(() => process.exit(0), 50); },",
  '};',
  "parentPort.on('message', ({ job, request }) => {",
  '  jobs += 1;',
  '  (behaviours[request.source] ?? ((each) => answer(each, true)))(job);',
  '});',
].join('\n');

export const counting = workerOf(countingSource);

export const countingElsewhere = workerOf(`${countingSource}\nvoid 0;`);

export const countingOnTheLoop = workerOf(
  [
    `import { serveJobs } from '${new URL('../program-pool/job-loop.ts', import.meta.url).href}';`,
    `import { answerOf } from '${new URL('../jobs/program-answer.ts', import.meta.url).href}';`,
    `import { foldAnswerOf } from '${new URL('../folds/fold-answer.ts', import.meta.url).href}';`,
    "import { threadId } from 'node:worker_threads';",
    'let jobs = 0;',
    'serveJobs({',
    '  program: (request, host) => {',
    '    jobs += 1;',
    "    if (request.source === 'count') {",
    '      const output = JSON.stringify({ jobs, thread: threadId });',
    "      return { ran: 'answered', output, bytes: output.length, work: 0 };",
    '    }',
    "    const early = request.source.startsWith('early:');",
    '    const source = early ? request.source.slice(6) : request.source;',
    '    return answerOf({ ...request, source, deadlineAt: early ? host.now() : request.deadlineAt }, host);',
    '  },',
    '  fold: (request, host) => {',
    '    jobs += 1;',
    "    return foldAnswerOf(request.variable === 'unreadable' ? { ...request, events: '{' } : request, host);",
    '  },',
    '});',
  ].join('\n'),
);
