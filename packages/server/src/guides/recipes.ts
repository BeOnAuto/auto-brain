import { readFileSync } from 'node:fs';

import type { Guide, Recipe } from '@beonauto/api';

type RecipeOutline = Omit<Recipe, 'text'>;

const outlines: readonly RecipeOutline[] = [
  {
    name: 'first-brain',
    title: 'Create your first brain',
    description: 'Creates a brain with a first reasoning function, and runs it once the person has agreed to it.',
    arguments: [],
    formatGuide: 'reasoning-function',
    calls: ['list_brains', 'create_brain', 'create_spec', 'execute_spec'],
    request: () => 'Create my first brain.',
  },
  {
    name: 'remember',
    title: 'Make the brain remember something',
    description: "Keeps what a function's runs answered in a recall function, so that the brain can tell it later.",
    arguments: [
      {
        name: 'what',
        description: "What the brain should remember, in the person's words, such as what it posted today",
        required: true,
      },
    ],
    formatGuide: 'recall-function',
    calls: ['list_specs', 'create_spec', 'update_spec', 'execute_spec'],
    request: ({ what }) => `Make the brain remember ${String(what)}.`,
  },
  {
    name: 'give-tools',
    title: 'Give the brain tools',
    description: 'Gives a reasoning function the tools of a tool server the brain may use.',
    arguments: [
      {
        name: 'server',
        description: 'The tool server whose tools to give, as list_tool_servers names it',
        required: false,
      },
    ],
    formatGuide: 'reasoning-function',
    calls: ['list_tool_servers', 'create_spec', 'execute_spec', 'get_execution_history'],
    request: ({ server }) =>
      server === undefined ? 'Give the brain tools.' : `Give the brain the tools of the tool server ${server}.`,
  },
  {
    name: 'schedule',
    title: 'Run a workflow on a schedule',
    description: 'Starts a workflow on a schedule or on an event, and reads how its runs went.',
    arguments: [
      { name: 'workflow', description: 'The name of the workflow to run', required: true },
      {
        name: 'when',
        description: "When to run it, in the person's words, such as every weekday at 9:00",
        required: true,
      },
    ],
    formatGuide: 'workflow',
    calls: ['list_specs', 'create_spec', 'update_spec', 'list_executions', 'get_execution'],
    request: ({ workflow, when }) => `Run the workflow ${String(workflow)} ${String(when)}.`,
  },
];

function textOf({ name }: RecipeOutline): string {
  return readFileSync(new URL(`recipes/${name}.md`, import.meta.url), 'utf8');
}

export function recipesFor(guides: readonly Guide[]): readonly Recipe[] {
  const carried = new Set(guides.map(({ name }) => name));
  return outlines
    .filter(({ formatGuide }) => carried.has(formatGuide))
    .map((outline) => Object.assign({ text: textOf(outline) }, outline));
}
