import type { CheckIssue } from '@beonauto/workflow-engine/worker';
import ts from 'typescript6';

import type { Located } from './diagnostics.ts';
import type { ExpressionsFile, Span } from './expressions-file.ts';

export interface ExpressionDiagnostics {
  readonly syntactic: readonly Located[];
  readonly semantic: () => readonly Located[];
}

export function oneExpression(names: readonly string[]): string {
  return `An expression is one TypeScript expression over ${names.join(', ')}`;
}

function isSoleReturn(statement: ts.Node): boolean {
  const block = statement.parent;
  return (
    ts.isReturnStatement(statement) &&
    ts.isBlock(block) &&
    block.statements.length === 1 &&
    ts.isFunctionDeclaration(block.parent) &&
    ts.isSourceFile(block.parent.parent)
  );
}

function wholeExpressions(file: () => ts.SourceFile): ReadonlySet<string> {
  const whole = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isParenthesizedExpression(node) && isSoleReturn(node.parent)) {
      whole.add(`${node.getStart()}:${node.getEnd()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file());
  return whole;
}

function isWithin({ first, lines }: Span, line: number): boolean {
  return line >= first - 2 && line <= first + lines + 1;
}

function placed({ index, first, lines }: Span, { line, detail }: Located): CheckIssue {
  return { at: index, line: Math.min(Math.max(1, line - first + 1), lines), detail };
}

function syntaxIssue(span: Span, located: Located): CheckIssue {
  const over = oneExpression(span.names).replace(/^A/u, 'a');
  return placed(span, { line: located.line, detail: `${located.detail.replace(/\.$/u, '')}; ${over}` });
}

function spanIssues(span: Span, diagnostics: ExpressionDiagnostics, whole: ReadonlySet<string>): readonly CheckIssue[] {
  const own = (found: readonly Located[]) => found.filter(({ line }) => isWithin(span, line));
  const syntactic = own(diagnostics.syntactic);
  if (syntactic.length > 0) {
    return syntactic.map((located) => syntaxIssue(span, located));
  }
  if (!whole.has(`${span.opening}:${span.closing}`)) {
    return [{ at: span.index, line: 1, detail: oneExpression(span.names) }];
  }
  return own(diagnostics.semantic()).map((located) => placed(span, located));
}

export function expressionIssues(
  file: () => ts.SourceFile,
  placedFile: ExpressionsFile,
  diagnostics: ExpressionDiagnostics,
): readonly CheckIssue[] {
  const whole = wholeExpressions(file);
  return placedFile.spans.flatMap((span) => spanIssues(span, diagnostics, whole));
}
