export type McpEndpoint = 'org' | 'brain' | 'own org';

export interface ServedTools {
  readonly orgTools: readonly string[];
  readonly brainTools: readonly string[];
}

interface Orientation {
  readonly when: (served: ServedTools, endpoint: McpEndpoint) => boolean;
  readonly text: string;
}

const concepts = [
  'A brain belongs to an org and holds functions, with which it reasons, interacts, predicts, recalls and computes, and workflows that coordinate them.',
  'A function or a workflow is a reusable definition, and a run executes it on an input.',
  'A reasoning function has a prompt and calls a language model.',
  'Until they are renamed, the tools say spec for a definition and execution for a run, primitive inference for a reasoning function and primitive orchestration for a workflow.',
  'When you answer the person, say in a sentence or two what was done and what they can do next, in the words of brains, functions, workflows and runs, and leave ids, statuses and the rules of this server out unless they ask.',
].join(' ');

const whatTheConnectionDoes: Readonly<Record<McpEndpoint, string>> = {
  org: 'This connection manages the brains of one org.',
  brain: 'This connection acts inside one brain.',
  'own org': "This connection acts in the caller's own org.",
};

function serves(...names: readonly string[]): (served: ServedTools) => boolean {
  return ({ orgTools, brainTools }) => names.every((name) => orgTools.includes(name) || brainTools.includes(name));
}

const orientation: readonly Orientation[] = [
  {
    when: serves('list_brains', 'create_brain'),
    text: 'Start with list_brains to see them, or create_brain to make one.',
  },
  {
    when: serves('create_spec'),
    text: [
      'A spec is a named, versioned definition in a brain.',
      'The primitive field selects a definition type; each tool describes its supported document formats.',
    ].join(' '),
  },
  {
    when: serves('list_models'),
    text: 'list_models lists the models this server can call.',
  },
  {
    when: serves('execute_spec', 'get_execution'),
    text: [
      'execute_spec runs a definition and records its run; execution_id identifies it.',
      'It may answer with status started while the work goes on; then poll get_execution until the status changes.',
    ].join(' '),
  },
  {
    when: serves('send_execution_event'),
    text: 'A waiting workflow run receives input through send_execution_event.',
  },
  {
    when: ({ brainTools }, endpoint) => endpoint === 'own org' && brainTools.length > 0,
    text: "Every tool that works inside a brain takes the brain's id as brain.",
  },
  {
    when: () => true,
    text: 'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
  },
];

export function instructionsFor(endpoint: McpEndpoint, served: ServedTools): string {
  return [
    concepts,
    whatTheConnectionDoes[endpoint],
    ...orientation.filter(({ when }) => when(served, endpoint)).map(({ text }) => text),
  ].join(' ');
}
