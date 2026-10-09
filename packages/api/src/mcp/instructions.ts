import { articled } from '@beonauto/operations';

export type McpEndpoint = 'org' | 'brain' | 'own org';

export interface DefinitionType {
  readonly type: string;
  readonly noun: string;
  readonly guide: string;
}

export interface ServedTools {
  readonly orgTools: readonly string[];
  readonly brainTools: readonly string[];
}

export interface RecipeCalls {
  readonly name: string;
  readonly calls: readonly string[];
}

interface Serving {
  readonly endpoint: McpEndpoint;
  readonly listed: (name: string) => boolean;
  readonly definitionTypes: readonly DefinitionType[];
  readonly reasoning: DefinitionType | undefined;
  readonly recipes: readonly RecipeCalls[];
}

type Sentences = (serving: Serving) => readonly string[];

const reasoningFunctionType = 'reasoning';

const purposeByType: Readonly<Record<string, string>> = {
  reasoning: 'A reasoning function has a prompt and calls a language model.',
  interaction: 'An interaction function asks a person or a system and takes the answer later.',
  computation: 'A computation function runs a program on its input and gives the same output every time.',
  recall:
    "A recall function answers from what it keeps of the brain's own history: every run's start and end, with its result when it succeeded, the definitions saved and the events published to the brain, never a run's input or its tool calls, so nothing has to write into it.",
  workflow: 'A workflow runs functions in steps, waits for input and can start on a schedule or on an event.',
};

const whatABrainIs = [
  'A brain is the complete system for a business responsibility.',
  'It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history.',
];

const pagedReads = ['list_runs', 'get_run_history', 'list_brain_events', 'list_interactions'];

const howToAnswer = [
  'When you tell the person what happened, say what was done and what they can do next,',
  "in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules;",
  'give an id or a status only when the person needs it to act.',
].join(' ');

const whenAToolCannot = 'A tool that cannot do what was asked says why and what to change.';

function inTurn(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`;
}

function brainsClause({ listed }: Serving, shows: string): readonly string[] {
  const shown = listed('list_brains') ? [`list_brains shows ${shows}`] : [];
  const made = listed('create_brain') ? [`create_brain makes ${shown.length === 0 ? 'a brain' : 'one'}`] : [];
  return [...shown, ...made];
}

function joinedClauses(opening: string, brains: readonly string[], rest: readonly string[]): string {
  const brainWords = brains.length === 0 ? '' : `: ${brains.join(' and ')}`;
  const restWords = rest.map((clause) => `, and ${clause}`).join('');
  return `${opening}${brainWords}${restWords}.`;
}

const whatTheConnectionDoes: Readonly<Record<McpEndpoint, (serving: Serving) => string>> = {
  'own org': (serving) =>
    joinedClauses("This connection acts in the caller's own org", brainsClause(serving, 'its brains'), []),
  org: (serving) =>
    joinedClauses('This connection manages the brains of one org', brainsClause(serving, 'them'), [
      "a brain's functions and workflows are made on the brain's own connection, /orgs/{org}/brains/{brain}/mcp",
    ]),
  brain: () => 'This connection acts inside one brain.',
};

const purposes: Sentences = ({ definitionTypes }) =>
  definitionTypes.flatMap(({ type }) => {
    const purpose = purposeByType[type];
    return purpose === undefined ? [] : [purpose];
  });

const connection: Sentences = (serving) => [whatTheConnectionDoes[serving.endpoint](serving)];

const modelsBeforeWriting: Sentences = ({ reasoning, listed }) =>
  reasoning !== undefined && listed('list_models') && !listed('list_tool_servers')
    ? ['list_models lists the models this server can call, which a reasoning function names.']
    : [];

const guides: Sentences = ({ listed, recipes }) => {
  if (!listed('create_definition')) {
    return ['get_guide holds what these words mean and how each kind of definition is written.'];
  }
  const served = recipes.map(({ name }) => name);
  const reading = 'Before writing a definition, read its format with get_guide';
  return [served.length === 0 ? `${reading}.` : `${reading}, which also holds the recipes: ${inTurn(served)}.`];
};

const modelsAndTools: Sentences = ({ reasoning, listed }) => {
  if (reasoning === undefined || !listed('list_tool_servers')) {
    return [];
  }
  const tools = 'may name tools that list_tool_servers lists';
  const testing = listed('test_tool_call') ? '; test_tool_call shows what a tool answers' : '';
  return [
    listed('list_models')
      ? `A reasoning function names a model that list_models lists and ${tools}${testing}.`
      : `A reasoning function names a model this server can call, as the ${reasoning.guide} guide says, and ${tools}${testing}.`,
  ];
};

const typesThatFinishLater: ReadonlySet<string> = new Set(['interaction', 'workflow']);

const runsThatFinishLater: Sentences = ({ listed, definitionTypes }) => {
  const finishingLater = definitionTypes
    .filter(({ type }) => typesThatFinishLater.has(type))
    .map(({ noun }) => articled(noun));
  return listed('get_run') && finishingLater.length > 0
    ? [`A run of ${finishingLater.join(' or ')} answers started; get_run shows whether it ended or still waits.`]
    : [];
};

const answeringWhatRunsWaitOn: Sentences = ({ listed }) =>
  listed('answer_interaction')
    ? [
        "When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, in the shape its function's answer takes, and start no new run for it.",
      ]
    : [];

const paging: Sentences = ({ listed }) => {
  const paged = listed('list_interactions') ? 'Runs, history, events and requests' : 'Runs, history and events';
  return pagedReads.some((name) => listed(name))
    ? [`${paged} come a page at a time; read on only when the person needs more.`]
    : [];
};

const closing: Sentences = () => [howToAnswer, whenAToolCannot];

const orientation: readonly Sentences[] = [
  purposes,
  connection,
  modelsBeforeWriting,
  guides,
  modelsAndTools,
  runsThatFinishLater,
  answeringWhatRunsWaitOn,
  paging,
  closing,
];

function namesOf(tools: ServedTools): readonly string[] {
  return [...tools.orgTools, ...tools.brainTools];
}

export function recipesFollowedWith<Calls extends RecipeCalls>(
  tools: ServedTools,
  recipes: readonly Calls[],
): readonly Calls[] {
  const names = namesOf(tools);
  return recipes.filter(({ calls }) => calls.every((name) => names.includes(name)));
}

export function instructionsFor(
  endpoint: McpEndpoint,
  tools: ServedTools,
  definitionTypes: readonly DefinitionType[],
  recipes: readonly RecipeCalls[],
): string {
  const names = namesOf(tools);
  const serving: Serving = {
    endpoint,
    listed: (name) => names.includes(name),
    definitionTypes,
    reasoning: definitionTypes.find(({ type }) => type === reasoningFunctionType),
    recipes: recipesFollowedWith(tools, recipes),
  };
  return [...whatABrainIs, ...orientation.flatMap((sentences) => sentences(serving))].join(' ');
}
