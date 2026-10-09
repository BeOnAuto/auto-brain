import { readFileSync } from 'node:fs';

import type { SandboxLib } from './sandbox-lib.ts';

export const keptLibFiles: Readonly<Record<keyof SandboxLib, URL>> = {
  script: new URL('../../lib/sandbox.d.ts.txt', import.meta.url),
  iterator: new URL('../../lib/sandbox-iterator.d.ts.txt', import.meta.url),
};

export function keptSandboxLib(): SandboxLib {
  return {
    script: readFileSync(keptLibFiles.script, 'utf8'),
    iterator: readFileSync(keptLibFiles.iterator, 'utf8'),
  };
}
