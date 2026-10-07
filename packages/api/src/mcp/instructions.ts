export type McpEndpoint = 'org' | 'brain' | 'own org';

export interface DefinitionType {
  readonly primitive: string;
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
  readonly names: readonly string[];
  readonly listed: (name: string) => boolean;
  readonly definitionTypes: readonly DefinitionType[];
  readonly reasoning: DefinitionType | undefined;
  readonly recipes: readonly RecipeCalls[];
}

type Sentences = (serving: Serving) => readonly string[];

const reasoningFunctionType = 'inference';

const purposeByType: Readonly<Record<string, string>> = {
  inference: 'A reasoning function has a prompt and calls a language model.',
  interaction: 'An interaction function asks a person or a system and takes the answer later.',
  computation: 'A computation function runs a program on its input and gives the same output every time.',
  recollection:
    "A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it.",
  orchestration: 'A workflow runs functions in steps, waits for input and can start on a schedule or on an event.',
};

const whatABrainIs = [
  'A brain is the complete system for a business responsibility.',
  'It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history.',
];

const wireWords = /(?:^|_)(?:specs?|executions?)(?:_|$)/u;

const pagedReads = ['list_executions', 'get_execution_history', 'list_brain_events'];

const howToAnswer = [
  'When you tell the person what happened, say what was done and what they can do next,',
  "in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules;",
  "give an id or a status only when the person needs it to act, as a run's id they will return to.",
].join(' ');

const whenAToolCannot = 'A tool that cannot do what was asked says why and what to change.';

function inTurn(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`;
}

function articled(noun: string): string {
  return /^[aeiou]/u.test(noun) ? `an ${noun}` : `a ${noun}`;
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
      "a brain's functions and workflows are made on the brain's own connection",
    ]),
  brain: () => 'This connection acts inside one brain.',
};

const purposes: Sentences = ({ definitionTypes }) =>
  definitionTypes.flatMap(({ primitive }) => {
    const purpose = purposeByType[primitive];
    return purpose === undefined ? [] : [purpose];
  });

const connection: Sentences = (serving) => [whatTheConnectionDoes[serving.endpoint](serving)];

const wireNames: Sentences = ({ names, definitionTypes }) => {
  if (!names.some((name) => wireWords.test(name))) {
    return [];
  }
  const naming = "The tools call a definition a spec, a run an execution and a definition's type its primitive";
  const types = inTurn(definitionTypes.map(({ primitive, noun }) => `${primitive} for ${articled(noun)}`));
  return [types === '' ? `${naming}.` : `${naming}: ${types}.`];
};

const modelsBeforeWriting: Sentences = ({ reasoning, listed }) =>
  reasoning !== undefined && listed('list_models') && !listed('list_tool_servers')
    ? ['list_models lists the models this server can call, which a reasoning function names.']
    : [];

const guides: Sentences = ({ listed, recipes }) => {
  if (!listed('create_spec')) {
    return ['get_guide holds what these words mean and how each kind of definition is written.'];
  }
  const served = recipes.filter(({ calls }) => calls.every((name) => listed(name))).map(({ name }) => name);
  const reading = 'Before writing a definition, read its format with get_guide';
  return [served.length === 0 ? `${reading}.` : `${reading}, which also holds the recipes: ${inTurn(served)}.`];
};

const modelsAndTools: Sentences = ({ reasoning, listed }) => {
  if (reasoning === undefined || !listed('list_tool_servers')) {
    return [];
  }
  const tools = 'may name tools that list_tool_servers lists';
  return [
    listed('list_models')
      ? `A reasoning function names a model that list_models lists and ${tools}.`
      : `A reasoning function names a model this server can call; the ${reasoning.guide} guide says how it is written, and it ${tools}.`,
  ];
};

const typesThatFinishLater: ReadonlySet<string> = new Set(['interaction', 'orchestration']);

const runsThatFinishLater: Sentences = ({ listed, definitionTypes }) => {
  const finishingLater = definitionTypes
    .filter(({ primitive }) => typesThatFinishLater.has(primitive))
    .map(({ noun }) => articled(noun));
  return listed('get_execution') && finishingLater.length > 0
    ? [`A run of ${finishingLater.join(' or ')} answers started; read it with get_execution until it ends.`]
    : [];
};

const paging: Sentences = ({ listed }) =>
  pagedReads.some((name) => listed(name))
    ? ['Runs, history and events come a page at a time; read on only when the person needs more.']
    : [];

const closing: Sentences = () => [howToAnswer, whenAToolCannot];

const orientation: readonly Sentences[] = [
  purposes,
  connection,
  wireNames,
  modelsBeforeWriting,
  guides,
  modelsAndTools,
  runsThatFinishLater,
  paging,
  closing,
];

export function instructionsFor(
  endpoint: McpEndpoint,
  tools: ServedTools,
  definitionTypes: readonly DefinitionType[],
  recipes: readonly RecipeCalls[],
): string {
  const names = [...tools.orgTools, ...tools.brainTools];
  const serving: Serving = {
    endpoint,
    names,
    listed: (name) => names.includes(name),
    definitionTypes,
    reasoning: definitionTypes.find(({ primitive }) => primitive === reasoningFunctionType),
    recipes,
  };
  return [...whatABrainIs, ...orientation.flatMap((sentences) => sentences(serving))].join(' ');
}
