export interface DocumentIssue {
  readonly line: number;
  readonly pointer: string;
  readonly detail: string;
}

export type SourceLines = ReadonlyMap<string, number>;

function selfAndAncestors(pointer: string): readonly string[] {
  const tokens = pointer.split('/');
  return tokens.map((_, index) => tokens.slice(0, index + 1).join('/'));
}

function lineOf(lines: SourceLines, pointer: string): number {
  return Math.max(...selfAndAncestors(pointer).map((ancestor) => lines.get(ancestor) ?? 0));
}

export function issueAt(lines: SourceLines, pointer: string, detail: string): DocumentIssue {
  return { line: lineOf(lines, pointer), pointer, detail };
}

export function issueText({ line, pointer, detail }: DocumentIssue): string {
  return pointer === '' ? `Line ${line}: ${detail}` : `Line ${line}, ${pointer}: ${detail}`;
}

export function byLine(first: DocumentIssue, second: DocumentIssue): number {
  return first.line - second.line;
}
