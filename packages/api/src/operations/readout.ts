import { problemOf, type Problem, type ProblemReason } from '../problem/problem.ts';

export type Readout<T> =
  | { readonly status: 'read'; readonly value: T }
  | { readonly status: 'refused'; readonly problem: Problem };

export function read<T>(value: T): Readout<T> {
  return { status: 'read', value };
}

export function refusedWith(reason: ProblemReason, detail: string): Readout<never> {
  return { status: 'refused', problem: problemOf(reason, detail) };
}
