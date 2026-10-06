import { taskNameOf } from '../dsl/tasks.ts';
import type { DslError } from '../machine/dsl-error.ts';
import {
  cutToBytes,
  mostNameBytes,
  mostTitleBytes,
  type Resumed,
  type Step,
  type StepCause,
  type StepKey,
  type StepOutcome,
  type WaitsFor,
} from './step-entry.ts';

export interface StepEntry {
  readonly reference: string;
  readonly run: number;
  readonly outcome: StepOutcome;
  readonly error?: DslError;
  readonly waitsFor?: WaitsFor;
  readonly child?: string;
  readonly times?: number;
}

export interface StepJournal {
  readonly record: (entry: StepEntry) => StepKey;
  readonly cause: () => StepCause;
  readonly causedBy: (cause: StepCause) => void;
  readonly resumedFrom: (waiting: Resumed) => void;
  readonly steps: () => readonly Step[];
  readonly resumed: () => Resumed | null;
}

interface Course {
  cause: StepCause;
  resumed: Resumed | null;
}

function errorShown(error: DslError | undefined): Pick<Step, 'error'> {
  if (error === undefined) {
    return {};
  }
  const { type, title } = error;
  return { error: { type, ...(title === undefined ? {} : { title: cutToBytes(title, mostTitleBytes) }) } };
}

function sameEntries(steps: readonly Step[], { reference, run, outcome }: StepEntry): number {
  return steps.filter((step) => step.reference === reference && step.run === run && step.outcome === outcome).length;
}

export function stepJournalOf(): StepJournal {
  const steps: Step[] = [];
  const course: Course = { cause: 'input', resumed: null };
  return {
    record: (entry) => {
      const { reference, run, outcome, waitsFor, child } = entry;
      const key = { reference, run, outcome, times: entry.times ?? 1 + sameEntries(steps, entry) };
      steps.push({
        ...key,
        name: cutToBytes(taskNameOf(reference), mostNameBytes),
        caused_by: course.cause,
        ...errorShown(entry.error),
        ...(waitsFor === undefined ? {} : { waits_for: waitsFor }),
        ...(child === undefined ? {} : { child }),
      });
      if (outcome !== 'cancelled') {
        course.cause = key;
      }
      return key;
    },
    cause: () => course.cause,
    causedBy: (cause) => {
      course.cause = cause;
    },
    resumedFrom: (waiting) => {
      course.resumed ??= waiting;
    },
    steps: () => steps,
    resumed: () => course.resumed,
  };
}
