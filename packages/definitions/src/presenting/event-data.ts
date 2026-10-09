import { Buffer } from 'node:buffer';

import { toolBounds } from '@beonauto/mcp';

const mostIssuesShown = 5;

const mostIssueDetailBytes = 256;

const mostPointerBytes = 128;

export const mostDetailBytes = 1024;

export const mostCallerBytes = 256;

export const mostDescriptionCharacters = 300;

export const mostNameBytes = 256;

export const mostContentBytes = toolBounds.shownContentBytes;

export const mostDigestBytes = 128;

export interface ShownIssue {
  readonly detail: string;
  readonly pointer: string;
}

function encodedBytesOf(character: string): number {
  return Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
}

export function cutAtCodePoint(text: string, mostBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += encodedBytesOf(character);
    if (bytes > mostBytes) {
      return text.slice(0, end);
    }
    end += character.length;
  }
  return text;
}

export function firstCharacters(text: string, count: number): string {
  let taken = 0;
  let end = 0;
  for (const character of text) {
    if (taken === count) {
      return text.slice(0, end);
    }
    taken += 1;
    end += character.length;
  }
  return text;
}

export function issuesShown(issues: readonly ShownIssue[]) {
  return {
    issue_count: issues.length,
    issues: issues.slice(0, mostIssuesShown).map(({ detail, pointer }) => ({
      detail: cutAtCodePoint(detail, mostIssueDetailBytes),
      pointer: cutAtCodePoint(pointer, mostPointerBytes),
    })),
  };
}
