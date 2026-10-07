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
  'It belongs to an org and holds functions, which do its work, and workflows, which coordinate them.',
  'A function or a workflow is a reusable definition, and a run executes it on an input.',
  'A reasoning function has a prompt and calls a language model.',
  'Until they are renamed, the tools say spec for a definition and execution for a run.',
  'When you answer the person, say in a sentence or two what was done and what they can do next, in the words of brains, functions, workflows and runs, and leave ids, statuses and the rules of this server out unless they ask.',
].join(' ');

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
      ? 'The primitive field selects a definition type'
      : `The primitive field selects a definition type, ${typesOf(definitionTypes)}`;
  return `A spec is a named, versioned definition in a brain. ${selects}; each tool describes its supported document formats.`;
}

const orientation: readonly Orientation[] = [
  {
    when: serves('list_brains', 'create_brain'),
    says: saying("Start with list_brains to see the org's brains, or create_brain to make one."),
  },
  { when: serves('create_spec'), says: primitiveField },
  { when: serves('list_models'), says: saying('list_models lists the models this server can call.') },
  {
    when: serves('execute_spec', 'get_execution'),
    says: saying(
      [
        'execute_spec runs a definition and records its run; execution_id identifies it.',
        'It may answer with status started while the work goes on; then poll get_execution until the status changes.',
      ].join(' '),
    ),
  },
  {
    when: serves('send_execution_event'),
    says: saying('A waiting workflow run receives input through send_execution_event.'),
  },
  {
    when: ({ endpoint, tools }) => endpoint === 'own org' && tools.brainTools.length > 0,
    says: saying("Every tool that works inside a brain takes the brain's id as brain."),
  },
  {
    when: () => true,
    says: saying(
      'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
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
