import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Group = 'pure' | 'control' | 'state';

const interpreter = join(import.meta.dirname, '..', '..', '..', 'primitives', 'orchestration', 'src', 'interpreter');

const controlFlow: Readonly<Record<string, readonly string[]>> = {
  'interpreter.ts': [
    'WorkflowStart',
    'startWorkflow',
    'ignoreEvent',
    'finish',
    'outcomeBeforeDeadline',
    'stopped',
    'outcomeOf',
    'interpret',
  ],
  'task-runner.ts': [
    'TaskStart',
    'runner',
    'runList',
    'runTask',
    'startTask',
    'runFrom',
    'performTask',
    'yieldToOthers',
  ],
  'simple-tasks.ts': ['waitTask'],
  'flow-tasks.ts': [
    'Settlement',
    'Contender',
    'Iteration',
    'doTask',
    'forTask',
    'forkTask',
    'iterate',
    'firstToSucceed',
    'raceForSuccess',
  ],
  'error-tasks.ts': ['Attempt', 'tryTask', 'attempt', 'handle', 'recover'],
  'listen-task.ts': ['listenTask', 'eachInTurn', 'nextEvent'],
  'call-task.ts': ['callTask', 'executed'],
  'timeouts.ts': ['withTimeout'],
  'invocation.ts': ['Scope', 'Runner', 'Invocation'],
  'host.ts': ['Cancellable', 'WorkflowHost'],
};

const closureState: Readonly<Record<string, readonly string[]>> = {
  'run-state.ts': ['Meter', 'RunState', 'makeRunState', 'contextHeldBy', 'makeMeter'],
  'inbox.ts': ['Inbox', 'Waiting', 'makeInbox'],
  'holding.ts': ['Holding', 'makeHolding'],
};

const declaration = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z_$][\w$]*)/u;

function groupOf(file: string, name: string): Group {
  if (controlFlow[file]?.includes(name) === true) {
    return 'control';
  }
  return closureState[file]?.includes(name) === true ? 'state' : 'pure';
}

const totals: Record<Group, number> = { pure: 0, control: 0, state: 0 };
const perFile: Record<string, Record<Group, number>> = {};
for (const file of readdirSync(interpreter)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .toSorted()) {
  const counts: Record<Group, number> = { pure: 0, control: 0, state: 0 };
  let current: Group = 'pure';
  let inImport = false;
  for (const line of readFileSync(join(interpreter, file), 'utf8').split('\n')) {
    if (line.startsWith('import ')) {
      inImport = !line.trimEnd().endsWith(';');
      continue;
    }
    if (inImport) {
      inImport = !line.trimEnd().endsWith(';');
      continue;
    }
    const name = declaration.exec(line)?.[1];
    if (name !== undefined) {
      current = groupOf(file, name);
    }
    if (line.trim() !== '') {
      counts[current] += 1;
      totals[current] += 1;
    }
  }
  perFile[file] = counts;
}

const all = totals.pure + totals.control + totals.state;
console.log('file'.padEnd(20), 'pure'.padStart(6), 'control'.padStart(8), 'state'.padStart(6));
for (const [file, counts] of Object.entries(perFile)) {
  console.log(
    file.padEnd(20),
    String(counts.pure).padStart(6),
    String(counts.control).padStart(8),
    String(counts.state).padStart(6),
  );
}
console.log(
  JSON.stringify({
    nonBlankNonImportLines: all,
    pure: totals.pure,
    control: totals.control,
    state: totals.state,
    share: {
      pure: +(totals.pure / all).toFixed(2),
      control: +(totals.control / all).toFixed(2),
      state: +(totals.state / all).toFixed(2),
    },
  }),
);
