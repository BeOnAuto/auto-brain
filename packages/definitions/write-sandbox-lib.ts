import { writeFileSync } from 'node:fs';

import { sandboxAnswers } from '@beonauto/workflow-engine/dsl';

import { keptLibFiles } from './src/program-check/kept-lib.ts';
import { sandboxLibOf } from './src/program-check/sandbox-lib.ts';

const lib = await sandboxLibOf(sandboxAnswers);

writeFileSync(keptLibFiles.script, lib.script);
writeFileSync(keptLibFiles.iterator, lib.iterator);
process.stdout.write(
  `Wrote the sandbox's lib, ${lib.script.length} and ${lib.iterator.length} characters, to ${keptLibFiles.script.pathname} and ${keptLibFiles.iterator.pathname}\n`,
);
