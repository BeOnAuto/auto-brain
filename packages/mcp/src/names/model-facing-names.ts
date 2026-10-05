import { createHash } from 'node:crypto';

import { writtenOf, type ToolReference } from './tool-reference.ts';

export interface Referring {
  readonly reference: ToolReference;
}

const mostModelFacingCharacters = 64;

const hashCharacters = 8;

const unsafeCharacters = /[^A-Za-z0-9_]/gu;

function hashOf(tool: ToolReference): string {
  return createHash('sha256').update(writtenOf(tool)).digest('hex').slice(0, hashCharacters);
}

function plainNameOf({ server, tool }: ToolReference): string {
  return `mcp__${server}__${tool}`.replaceAll(unsafeCharacters, '_');
}

function hashedNameOf(tool: ToolReference): string {
  const room = mostModelFacingCharacters - hashCharacters - 1;
  return `${plainNameOf(tool).slice(0, room)}_${hashOf(tool)}`;
}

function needsHash(name: string, plainNames: readonly string[]): boolean {
  return name.length > mostModelFacingCharacters || plainNames.indexOf(name) !== plainNames.lastIndexOf(name);
}

export function modelFacingNames<Item extends Referring>(
  items: readonly Item[],
): readonly (Item & { readonly name: string })[] {
  const plainNames = items.map(({ reference }) => plainNameOf(reference));
  return items.map((item) => {
    const plain = plainNameOf(item.reference);
    return { ...item, name: needsHash(plain, plainNames) ? hashedNameOf(item.reference) : plain };
  });
}
