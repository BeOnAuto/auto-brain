import {
  bulletList,
  inputSection,
  numberedList,
  outputSection,
  paragraph,
  sectionOf,
  type OverviewSection,
} from '@on.auto/definitions';
import { field, type JsonObject } from '@on.auto/workflow-engine';

import type { ReadWorkflow } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { taskDiagramOf } from '../steps/task-diagram.ts';
import { calledSection } from './called-definitions.ts';
import { startsOf } from './trigger-words.ts';

function doneSection(document: JsonObject, entries: readonly string[]): OverviewSection {
  const { diagram, steps } = taskDiagramOf(field(document, 'do'), entries);
  return steps.length === 0
    ? sectionOf('What it does', paragraph('It has no steps, so a run ends as it starts.'))
    : sectionOf('What it does', diagram, paragraph('Its steps, numbered as in the diagram:'), numberedList(steps));
}

export function workflowOverview({ document }: ReadWorkflow): readonly OverviewSection[] {
  const { inputSchema, outputSchema, triggers = [] } = summaryOf(document);
  const starts = startsOf(triggers);
  return [
    sectionOf('What starts it', bulletList(starts.map(({ words }) => words))),
    inputSection(inputSchema),
    outputSection(outputSchema),
    doneSection(
      document,
      starts.map(({ label }) => label),
    ),
    calledSection(document),
  ];
}
