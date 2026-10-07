import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { internalTermsIn } from '../testing/internal-terms.ts';
import {
  instructionsFor,
  type DefinitionType,
  type McpEndpoint,
  type RecipeCalls,
  type ServedTools,
} from './instructions.ts';

const brainTools = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

const insideABrain = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
  'cancel_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
  'list_brain_events',
  'publish_event',
  'list_tool_servers',
  'list_interactions',
  'answer_interaction',
  'send_execution_event',
  'get_guide',
];

const queriesInsideABrain = [
  'list_specs',
  'get_spec',
  'get_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
  'list_brain_events',
  'list_tool_servers',
  'list_interactions',
  'get_guide',
];

const orgEndpoint: ServedTools = { orgTools: [...brainTools, 'list_models', 'get_guide'], brainTools: [] };

const brainEndpoint: ServedTools = { orgTools: [], brainTools: insideABrain };

const ownOrg: ServedTools = { orgTools: [...brainTools, 'list_models'], brainTools: insideABrain };

const definitionTypes: readonly DefinitionType[] = [
  { primitive: 'inference', noun: 'reasoning function', guide: 'reasoning-function' },
  { primitive: 'interaction', noun: 'interaction function', guide: 'interaction-function' },
  { primitive: 'computation', noun: 'computation function', guide: 'computation-function' },
  { primitive: 'recollection', noun: 'recall function', guide: 'recall-function' },
  { primitive: 'orchestration', noun: 'workflow', guide: 'workflow' },
];

const recipes: readonly RecipeCalls[] = [
  { name: 'first-brain', calls: ['list_brains', 'create_brain', 'create_spec', 'execute_spec'] },
  { name: 'remember', calls: ['list_specs', 'create_spec', 'update_spec', 'execute_spec'] },
  { name: 'give-tools', calls: ['list_tool_servers', 'create_spec', 'execute_spec', 'get_execution_history'] },
  { name: 'schedule', calls: ['list_specs', 'create_spec', 'update_spec', 'list_executions', 'get_execution'] },
];

const everyEndpoint: readonly (readonly [McpEndpoint, ServedTools])[] = [
  ['org', orgEndpoint],
  ['brain', brainEndpoint],
  ['own org', ownOrg],
];

const recordOnMcp =
  "A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model. A computation function runs a program on its input and gives the same output every time. A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection acts in the caller's own org: list_brains shows its brains and create_brain makes one, and every tool inside a brain takes the brain's id as brain. The tools call a definition a spec, a run an execution and a definition's type its primitive: inference for a reasoning function, computation for a computation function, recollection for a recall function and orchestration for a workflow. Before writing a definition, read its format with get_guide, which also holds the recipes: first-brain, remember, give-tools and schedule. A reasoning function names a model that list_models lists and may name tools that list_tool_servers lists. A workflow run answers started and ends later: read it with get_execution until its status changes, and give a run that waits for input its event with send_execution_event. Runs, history and events come a page at a time; read on only when the person needs more. When you tell the person what happened, say what was done and what they can do next, in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules; give an id or a status only when the person needs it to act, as a run's id they will return to. A tool that cannot do what was asked says why and what to change.";

const recordOnAnOrg =
  "A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model. A computation function runs a program on its input and gives the same output every time. A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection manages the brains of one org: list_brains shows them and create_brain makes one, and a brain's functions and workflows are made on the brain's own connection. list_models lists the models this server can call, which a reasoning function names. get_guide holds what these words mean and how each kind of definition is written. When you tell the person what happened, say what was done and what they can do next, in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules; give an id or a status only when the person needs it to act, as a run's id they will return to. A tool that cannot do what was asked says why and what to change.";

const recordOnABrain =
  "A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model. A computation function runs a program on its input and gives the same output every time. A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection acts inside one brain. The tools call a definition a spec, a run an execution and a definition's type its primitive: inference for a reasoning function, computation for a computation function, recollection for a recall function and orchestration for a workflow. Before writing a definition, read its format with get_guide, which also holds the recipes: remember, give-tools and schedule. A reasoning function names a model this server can call; the reasoning-function guide says how it is written, and it may name tools that list_tool_servers lists. A workflow run answers started and ends later: read it with get_execution until its status changes, and give a run that waits for input its event with send_execution_event. Runs, history and events come a page at a time; read on only when the person needs more. When you tell the person what happened, say what was done and what they can do next, in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules; give an id or a status only when the person needs it to act, as a run's id they will return to. A tool that cannot do what was asked says why and what to change.";

const recordWorkflowSentence =
  'A workflow run answers started and ends later: read it with get_execution until its status changes, and give a run that waits for input its event with send_execution_event.';

const runsSentence = 'A run of a workflow answers started; read it with get_execution until it ends.';

const recordBrainArgument = ", and every tool inside a brain takes the brain's id as brain.";

function asServedWithFourTypes(recordText: string): string {
  return recordText.replace(recordWorkflowSentence, runsSentence).replace(recordBrainArgument, '.');
}

const interactionSentence = 'An interaction function asks a person or a system and takes the answer later.';

function asServedWithFiveTypes(recordText: string): string {
  return asServedWithFourTypes(recordText)
    .replace(
      'A reasoning function has a prompt and calls a language model.',
      `A reasoning function has a prompt and calls a language model. ${interactionSentence}`,
    )
    .replace(
      'inference for a reasoning function,',
      'inference for a reasoning function, interaction for an interaction function,',
    )
    .replace(
      runsSentence,
      'A run of an interaction function or a workflow answers started; read it with get_execution until it ends.',
    );
}

const wireNamesSentence =
  "The tools call a definition a spec, a run an execution and a definition's type its primitive: inference for a reasoning function, interaction for an interaction function, computation for a computation function, recollection for a recall function and orchestration for a workflow.";

const terminology = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

const resourcesOnTheTerminologyPage: ReadonlySet<string> = new Set(
  [...terminology.matchAll(/^\| \w+ +\| ([A-Z][a-z]+(?: function)?) +\| /gmu)].map(
    ([, resource = '']: readonly string[]) => resource.toLowerCase(),
  ),
);

function definitionOfABrainOnTheTerminologyPage(): string {
  const [, definition = ''] =
    /^\| Brain +\| (The complete system for a business responsibility),/mu.exec(terminology) ?? [];
  return definition;
}

describe('the instructions of each endpoint, for a key that may call every tool', () => {
  it.each([
    ['own org', ownOrg, recordOnMcp],
    ['org', orgEndpoint, recordOnAnOrg],
    ['brain', brainEndpoint, recordOnABrain],
  ] as const)(
    'read on the %s endpoint as the decision record gives them, with a sentence per type the server runs, and the run sentence and the brain argument the bound leaves room for',
    (endpoint, served, recordText) => {
      expect(instructionsFor(endpoint, served, definitionTypes, recipes)).toBe(asServedWithFiveTypes(recordText));
    },
  );

  it.each([
    ['own org', ownOrg, recordOnMcp],
    ['org', orgEndpoint, recordOnAnOrg],
    ['brain', brainEndpoint, recordOnABrain],
  ] as const)(
    'read on the %s endpoint of a server with the four types of the record as the record gives them, but for those two',
    (endpoint, served, recordText) => {
      const fourTypes = definitionTypes.filter(({ primitive }) => primitive !== 'interaction');

      expect(instructionsFor(endpoint, served, fourTypes, recipes)).toBe(asServedWithFourTypes(recordText));
    },
  );

  it.each(everyEndpoint)('stay under 2,000 characters on the %s endpoint', (endpoint, served) => {
    expect(instructionsFor(endpoint, served, definitionTypes, recipes).length).toBeLessThan(2000);
  });
});

describe('the instructions of a key that may only read', () => {
  it('name no command, and point to the guides without the recipes the key could not follow', () => {
    const reading = instructionsFor(
      'own org',
      { orgTools: ['list_brains', 'get_brain', 'list_models', 'get_guide'], brainTools: queriesInsideABrain },
      definitionTypes,
      recipes,
    );

    expect(
      [
        'create_brain',
        'create_spec',
        'execute_spec',
        'send_execution_event',
        'answer_interaction',
        'first-brain',
      ].filter((name) => reading.includes(name)),
    ).toEqual([]);
    expect(reading).toContain("This connection acts in the caller's own org: list_brains shows its brains.");
    expect(reading).toContain('get_guide holds what these words mean and how each kind of definition is written.');
  });

  it('on a brain endpoint, say how a reasoning function names its tools without naming the models it cannot list', () => {
    const reading = instructionsFor(
      'brain',
      { orgTools: [], brainTools: queriesInsideABrain },
      definitionTypes,
      recipes,
    );

    expect(reading).toContain(
      'get_guide holds what these words mean and how each kind of definition is written. A reasoning function names a model this server can call;',
    );
  });

  it('on an org endpoint that only creates brains, say that it makes a brain', () => {
    expect(instructionsFor('org', { orgTools: ['create_brain'], brainTools: [] }, definitionTypes, recipes)).toContain(
      "This connection manages the brains of one org: create_brain makes a brain, and a brain's functions and workflows are made on the brain's own connection.",
    );
  });
});

describe('what the instructions say of the definition types', () => {
  it('give a sentence only to a type the server runs, and the wire names of each type it runs', () => {
    const reasoningAlone = definitionTypes.slice(0, 1);
    const instructions = instructionsFor('brain', brainEndpoint, reasoningAlone, recipes);

    expect(instructions).toContain('A reasoning function has a prompt and calls a language model.');
    expect(
      ['computation function', 'recall function', 'A workflow runs'].filter((words) => instructions.includes(words)),
    ).toEqual([]);
    expect(instructions).toContain("a definition's type its primitive: inference for a reasoning function.");
  });

  it('give no sentence to a type they have no words for, and name no wire value when the server runs no type', () => {
    const interacting = [{ primitive: 'interaction', noun: 'interaction function', guide: 'interaction-function' }];

    expect(instructionsFor('brain', brainEndpoint, interacting, recipes)).toContain(
      "This connection acts inside one brain. The tools call a definition a spec, a run an execution and a definition's type its primitive: interaction for an interaction function.",
    );
    expect(instructionsFor('brain', brainEndpoint, [], recipes)).toContain(
      "This connection acts inside one brain. The tools call a definition a spec, a run an execution and a definition's type its primitive. Before",
    );
  });

  it('say nothing of models and tools where the server runs no reasoning function', () => {
    const withoutReasoning = definitionTypes.slice(1);

    expect(
      ['list_models', 'list_tool_servers'].filter((name) =>
        [
          instructionsFor('own org', ownOrg, withoutReasoning, recipes),
          instructionsFor('org', orgEndpoint, withoutReasoning, recipes),
        ].some((instructions) => instructions.includes(name)),
      ),
    ).toEqual([]);
  });

  it('point to get_guide without recipes where no recipe can be followed', () => {
    expect(instructionsFor('brain', brainEndpoint, definitionTypes, [])).toContain(
      'Before writing a definition, read its format with get_guide. A reasoning function',
    );
  });

  it('name the one recipe that can be followed without a list', () => {
    expect(instructionsFor('brain', brainEndpoint, definitionTypes, recipes.slice(1, 2))).toContain(
      'read its format with get_guide, which also holds the recipes: remember.',
    );
  });
});

describe('the instructions of every endpoint', () => {
  it('open with the definition of a brain the terminology page gives', () => {
    const definition = definitionOfABrainOnTheTerminologyPage();

    expect(definition).toBe('The complete system for a business responsibility');
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes, recipes).startsWith(
            `A brain is ${definition.toLowerCase()}.`,
          ),
      ),
    ).toEqual([]);
  });

  it('name as function types and resources only those on the terminology page', () => {
    expect(definitionTypes.filter(({ noun }) => !resourcesOnTheTerminologyPage.has(noun))).toEqual([]);
  });

  it('use no term of the internal vocabulary once the sentence that maps the wire names is taken out, and no product name', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) =>
      instructionsFor(endpoint, served, definitionTypes, recipes).replace(wireNamesSentence, ''),
    );

    expect(instructions.flatMap((text) => internalTermsIn(text))).toEqual([]);
    expect(instructions.filter((text) => /\bauto\b|renamed/iu.test(text))).toEqual([]);
  });

  it('map the wire names only where a tool listed carries one', () => {
    expect(instructionsFor('org', orgEndpoint, definitionTypes, recipes)).not.toContain('a run an execution');
  });
});
