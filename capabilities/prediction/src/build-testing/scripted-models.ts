import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { scratchDirectory } from '../testing/scratch.ts';

export type Script =
  | 'real'
  | 'shifted'
  | 'slow'
  | 'sleeps'
  | 'exits'
  | 'allocates'
  | 'garbage'
  | 'badly'
  | 'not-finite'
  | 'crossed'
  | 'unreadable';

export interface ScriptedModels {
  readonly module: Readonly<URL>;
  readonly next: (script: Script) => void;
}

const processLoop = import.meta.resolve('@on.auto/workflow-engine/process-loop');

const realJobs = new URL('../model-jobs/model-jobs.ts', import.meta.url).href;

function sourceOf(scriptFile: string): string {
  return [
    "import { readFileSync } from 'node:fs';",
    `import { serveProcessJobs } from '${processLoop}';`,
    `import { modelJobs } from '${realJobs}';`,
    'const real = modelJobs();',
    'const scripts = {',
    '  real: (kind, payload) => real[kind](payload),',
    '  shifted: async (kind, payload) => {',
    '    const answer = await real[kind](payload);',
    "    return kind === 'walk' ? { series: answer.series, q: answer.q.map((q) => q.map((value) => value + 100)) } : answer;",
    '  },',
    '  slow: async (kind, payload) => {',
    '    await new Promise((resolve) => setTimeout(resolve, 300));',
    '    return real[kind](payload);',
    '  },',
    '  sleeps: () => new Promise(() => {}),',
    '  exits: () => process.exit(3),',
    "  allocates: () => { throw new RangeError('Array buffer allocation failed'); },",
    '  garbage: () => ({ nonsense: true }),',
    "  badly: () => ({ badly: 'The scripted model answered badly' }),",
    "  unreadable: () => { throw new Error('The rows could not be read'); },",
    "  'not-finite': async (kind, payload) => {",
    "    if (kind !== 'walk') return { q: new Float32Array(6).fill(Number.NaN), dims: [1, 2, 3] };",
    '    const answer = await real.walk(payload);',
    '    return { series: answer.series, q: answer.q.map((q) => q.map(() => Number.NaN)) };',
    '  },',
    '  crossed: () => ({ q: Float32Array.of(9, 11, 13, 12, 11, 13), dims: [1, 2, 3] }),',
    '};',
    `const scriptOf = () => readFileSync(${JSON.stringify(scriptFile)}, 'utf8');`,
    'const scripted = (kind) => (payload) => scripts[scriptOf()](kind, payload);',
    "const window = (payload) => (scriptOf() === 'unreadable' ? scripts.unreadable() : real.window(payload));",
    "serveProcessJobs({ check: scripted('check'), run: scripted('run'), walk: scripted('walk'), window }, process);",
  ].join('\n');
}

export function scriptedModels(): ScriptedModels {
  const directory = scratchDirectory();
  const scriptFile = join(directory, 'script');
  const module = pathToFileURL(join(directory, 'scripted-model-process.mjs'));
  writeFileSync(scriptFile, 'real');
  writeFileSync(module, sourceOf(scriptFile));
  return {
    module,
    next: (script) => {
      writeFileSync(scriptFile, script);
    },
  };
}
