import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  functionCategoryLabels,
  functionDescriptions,
  functionKindOrder,
  functionResourceLabels,
} from '@beonauto/specs';

export const functionTaxonomyDocument = `${JSON.stringify(
  {
    schema: 1,
    source: '@beonauto/specs',
    functions: functionKindOrder.map((kind) => ({
      kind,
      label: functionCategoryLabels[kind],
      singular: functionResourceLabels[kind].singular,
      plural: functionResourceLabels[kind].plural,
      description: functionDescriptions[kind],
    })),
  },
  null,
  2,
)}\n`;

export function writeFunctionTaxonomy(path: string): 'updated' | 'unchanged' {
  if (existsSync(path) && readFileSync(path, 'utf8') === functionTaxonomyDocument) return 'unchanged';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, functionTaxonomyDocument);
  return 'updated';
}

export function checkFunctionTaxonomy(path: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== functionTaxonomyDocument) {
    throw new Error(`Function taxonomy is missing or stale at ${path}. Run pnpm docs:taxonomy.`);
  }
}

export function runFunctionTaxonomy(commandArguments: readonly string[], path: string): void {
  if (commandArguments.length === 0) {
    writeFunctionTaxonomy(path);
  } else if (commandArguments.length === 1 && commandArguments[0] === '--check') {
    checkFunctionTaxonomy(path);
  } else {
    throw new Error('Usage: pnpm docs:taxonomy [--check]');
  }
}

if (import.meta.main) {
  runFunctionTaxonomy(process.argv.slice(2), resolve(import.meta.dirname, '../docs/assets/brain-functions.json'));
}
