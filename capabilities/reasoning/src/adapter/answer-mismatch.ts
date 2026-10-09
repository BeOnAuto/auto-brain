import type { SchemaIssue } from '@beonauto/definitions/document';

export class AnswerMismatch extends Error {
  readonly issues: readonly SchemaIssue[];

  constructor(issues: readonly SchemaIssue[]) {
    super('The answer does not match the output schema');
    this.name = 'AnswerMismatch';
    this.issues = issues;
  }
}
