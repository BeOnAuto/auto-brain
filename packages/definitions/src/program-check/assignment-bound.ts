import ts from 'typescript6';

import type { Located } from './diagnostics.ts';

export const mostAssignmentsInAFunction = 500;

export const fewerAssignments = `A function may assign to its variables at most ${mostAssignmentsInAFunction} times, since the compiler's analysis of each assignment grows with the others; keep the values in a list, an object or a loop`;

const stepping: ReadonlySet<ts.SyntaxKind> = new Set([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken]);

function isAssignment(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    return operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
  }
  return (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && stepping.has(node.operator);
}

function lineOf(node: ts.Node): number {
  const file = node.getSourceFile();
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

export function assignmentIssues(file: () => ts.SourceFile): readonly Located[] {
  const found: Located[] = [];
  const counts = new Map<ts.Node, number>();
  const count = (node: ts.Node, owner: ts.Node): void => {
    const own = ts.isFunctionLike(node) ? node : owner;
    if (isAssignment(node)) {
      const assigned = (counts.get(own) ?? 0) + 1;
      counts.set(own, assigned);
      if (assigned === mostAssignmentsInAFunction + 1) {
        found.push({ line: lineOf(node), detail: fewerAssignments });
      }
    }
    ts.forEachChild(node, (child) => {
      count(child, own);
    });
  };
  count(file(), file());
  return found;
}
