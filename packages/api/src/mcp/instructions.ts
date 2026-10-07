export type McpEndpoint = 'org' | 'brain' | 'own org';

export interface DefinitionType {
  readonly primitive: string;
  readonly noun: string;
}

export interface ServedTools {
  readonly orgTools: readonly string[];
  readonly brainTools: readonly string[];
}

interface Serving {
  readonly endpoint: McpEndpoint;
  readonly tools: ServedTools;
  readonly definitionTypes: readonly DefinitionType[];
}

interface Orientation {
  readonly when: (serving: Serving) => boolean;
  readonly says: (serving: Serving) => string;
}

const concepts = [
  'A brain is the complete system for a business responsibility.',
  'It belongs to an org and holds functions and the workflows that coordinate them.',
  'A function or a workflow is a reusable definition, and a run executes it on an input.',
  'A reasoning function has a prompt and calls a language model.',
  'The tools say spec for a definition and execution for a run.',
  "Answer the person in a sentence or two: what was done and what they can do next, in the words of brains, functions, workflows and runs, without ids, statuses or this server's rules unless asked.",
].join(' ');

const recallFunctionType = 'recollection';

const whatARecallFunctionKeeps =
  "A recall function keeps a view folded from the brain's own history, its runs with their outputs and published events, so nothing needs to write into it, and answers from it without a model.";

const whatTheConnectionDoes: Readonly<Record<McpEndpoint, string>> = {
  org: 'This connection manages the brains of one org.',
  brain: 'This connection acts inside one brain.',
  'own org': "This connection acts in the caller's own org.",
};

function serves(...names: readonly string[]): (serving: Serving) => boolean {
  return ({ tools: { orgTools, brainTools } }) =>
    names.every((name) => orgTools.includes(name) || brainTools.includes(name));
}

function saying(text: string): () => string {
  return () => text;
}

function articled(noun: string): string {
  return /^[aeiou]/u.test(noun) ? `an ${noun}` : `a ${noun}`;
}

function separatorBefore(index: number, count: number): string {
  if (index === 0) {
    return '';
  }
  return index === count - 1 ? ' or ' : ', ';
}

function typesOf(definitionTypes: readonly DefinitionType[]): string {
  return definitionTypes
    .map(
      ({ primitive, noun }, index) =>
        `${separatorBefore(index, definitionTypes.length)}${primitive} for ${articled(noun)}`,
    )
    .join('');
}

function primitiveField({ definitionTypes }: Serving): string {
  const selects =
    definitionTypes.length === 0
      ? 'primitive field selects its type'
      : `primitive field selects its type, ${typesOf(definitionTypes)}`;
  return `A spec is a named, versioned definition whose ${selects}; each tool describes their formats.`;
}

function definesRecallFunctions(serving: Serving): boolean {
  return (
    serves('create_spec')(serving) && serving.definitionTypes.some(({ primitive }) => primitive === recallFunctionType)
  );
}

const orientation: readonly Orientation[] = [
  {
    when: serves('list_brains', 'create_brain'),
    says: saying('Start with list_brains, or create_brain to make one.'),
  },
  { when: serves('create_spec'), says: primitiveField },
  { when: definesRecallFunctions, says: saying(whatARecallFunctionKeeps) },
  { when: serves('list_models'), says: saying('list_models lists the models this server can call.') },
  {
    when: serves('list_tool_servers'),
    says: saying('list_tool_servers lists the tool servers the brain may use and their tools.'),
  },
  {
    when: serves('execute_spec', 'get_execution'),
    says: saying(
      'execute_spec runs a definition and records its run under an execution_id; while its status is started, poll get_execution until it changes.',
    ),
  },
  {
    when: serves('send_execution_event'),
    says: saying('A waiting workflow run receives input through send_execution_event.'),
  },
  {
    when: ({ endpoint, tools }) => endpoint === 'own org' && tools.brainTools.length > 0,
    says: saying("Every tool inside a brain takes the brain's id as brain."),
  },
  {
    when: () => true,
    says: saying(
      'A tool that cannot do what was asked returns isError with a problem document whose reason and detail say why.',
    ),
  },
];

export function instructionsFor(
  endpoint: McpEndpoint,
  tools: ServedTools,
  definitionTypes: readonly DefinitionType[],
): string {
  const serving: Serving = { endpoint, tools, definitionTypes };
  return [
    concepts,
    whatTheConnectionDoes[endpoint],
    ...orientation.filter(({ when }) => when(serving)).map(({ says }) => says(serving)),
  ].join(' ');
}
