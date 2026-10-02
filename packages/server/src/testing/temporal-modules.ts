import { createRequire } from 'node:module';

const loadedModules = createRequire(import.meta.url).cache;

const temporal = /[/\\]@temporalio[/\\]/u;

process.on('exit', () => {
  const loaded = Object.keys(loadedModules).filter((path) => temporal.test(path)).length;
  process.stderr.write(`Temporal modules loaded: ${loaded}\n`);
});
