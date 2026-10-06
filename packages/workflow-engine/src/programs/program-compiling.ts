import { parse, runAst, validate } from '@gabrielbryk/jq-ts';

import type { Json } from '../dsl/json.ts';
import { dialectIssues, freeVariablesIn, type Dialect } from './program-dialect.ts';
import {
  evalOptionsOf,
  failureOf,
  outcomeOf,
  toValue,
  type ProgramOptions,
  type ProgramRun,
} from './program-running.ts';
import { childrenOf, issueOf, spanOf, type ProgramIssue } from './program-tree.ts';

export interface Program {
  readonly run: (input: Json, options: ProgramOptions) => ProgramRun;
  readonly freeVariables: readonly string[];
}

export type ProgramIssues = readonly [ProgramIssue, ...ProgramIssue[]];

export type CompiledProgram = { readonly program: Program } | { readonly issues: ProgramIssues };

interface Placed {
  readonly node: unknown;
  readonly depth: number;
}

export const mostSyntaxDepth = 128;

function tooDeepIn(tree: unknown): ProgramIssue | undefined {
  const pending: Placed[] = [{ node: tree, depth: 1 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.depth > mostSyntaxDepth) {
      return { detail: `The program nests more than ${mostSyntaxDepth} levels deep`, span: spanOf(next.node) };
    }
    const depth = next.depth + 1;
    pending.push(...childrenOf(next.node).map((node) => ({ node, depth })));
  }
  return undefined;
}

export function compileProgram(source: string, dialect: Dialect): CompiledProgram {
  try {
    const tree = parse(source, { maxDepth: mostSyntaxDepth });
    const deep = tooDeepIn(tree);
    if (deep !== undefined) {
      return { issues: [deep] };
    }
    const [refused, ...more] = dialectIssues(tree, dialect);
    if (refused !== undefined) {
      return { issues: [refused, ...more] };
    }
    validate(tree);
    return {
      program: {
        freeVariables: freeVariablesIn(tree),
        run: (input, options) => {
          const usage = { work: 0 };
          try {
            return outcomeOf(runAst(tree, toValue(input), { ...evalOptionsOf(options), usage }), usage.work, options);
          } catch (error) {
            return failureOf(error, usage.work);
          }
        },
      },
    };
  } catch (error) {
    return { issues: [issueOf(error)] };
  }
}

export function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}
