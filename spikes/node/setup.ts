import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const spike = import.meta.dirname;
const repository = join(spike, '..', '..');

const borrowedFromTheLedger = ['effect', '@event-driven-io/emmett', '@event-driven-io/emmett-sqlite'];

for (const name of borrowedFromTheLedger) {
  const target = realpathSync(join(repository, 'packages', 'ledger', 'node_modules', name));
  const link = join(spike, 'node_modules', name);
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(target, link, 'dir');
  console.log(`${name} -> ${target}`);
}
