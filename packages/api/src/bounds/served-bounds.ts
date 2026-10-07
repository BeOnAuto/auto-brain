import { Buffer } from 'node:buffer';

export const mostInstructionCharacters = 2000;

export const mostDescriptionCharacters = 800;

export const mostArgumentDescriptionCharacters = 300;

export const mostToolsOnAConnection = 24;

export const mostGuideBytes = 65_536;

export const mostRecipeBytes = 4096;

export const mostGuides = 9;

export const mostRecipes = 4;

export function requireWithin(what: string, size: number, most: number, unit: string): void {
  if (size > most) {
    throw new Error(`${what}: ${size} ${unit}, more than the ${most} allowed`);
  }
}

export function requireTextWithin(what: string, text: string, most: number): void {
  requireWithin(what, text.length, most, 'characters');
}

export function requireBytesWithin(what: string, text: string, most: number): void {
  requireWithin(what, Buffer.byteLength(text, 'utf8'), most, 'bytes');
}
