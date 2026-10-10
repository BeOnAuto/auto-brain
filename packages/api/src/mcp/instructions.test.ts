import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { internalTermsIn } from '../testing/internal-terms.ts';
import {
  brainEndpoint,
  definitionTypes,
  everyEndpoint,
  orgEndpoint,
  ownOrg,
  queriesInsideABrain,
  recipes,
} from '../testing/served-instructions.ts';
import { instructionsFor, type ServedTools } from './instructions.ts';

const recordOnMcp =
  "A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model. A computation function runs a program on its input and gives the same output every time. A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection acts in the caller's own org: list_brains shows its brains and create_brain makes one, and every tool inside a brain takes the brain's id as brain. Before writing a definition, read its format with get_guide, which also holds the recipes: first-brain, remember, give-tools and schedule. A reasoning function names a model that list_models lists and may name tools that list_tool_servers lists. A workflow run answers started and ends later: read it with get_run until its status changes, and give a run that waits for input its event with send_run_event. Runs, history and events come a page at a time; read on only when the person needs more. When you tell the person what happened, say what was done and what they can do next, in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules; give an id or a status only when the person needs it to act, as a run's id they will return to. A tool that cannot do what was asked says why and what to change.";

const recordOnAnOrg =
  "A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model. A computation function runs a program on its input and gives the same output every time. A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection manages the brains of one org: list_brains shows them and create_brain makes one, and a brain's functions and workflows are made on the brain's own connection. list_models lists the models this server can call, which a reasoning function names. get_guide holds what these words mean and how each kind of definition is written. When you tell the person what happened, say what was done and what they can do next, in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules; give an id or a status only when the person needs it to act, as a run's id they will return to. A tool that cannot do what was asked says why and what to change.";

const recordOnABrain =
  "A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. A reasoning function has a prompt and calls a language model. A computation function runs a program on its input and gives the same output every time. A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it. A workflow runs functions in steps, waits for input and can start on a schedule or on an event. This connection acts inside one brain. Before writing a definition, read its format with get_guide, which also holds the recipes: remember, give-tools and schedule. A reasoning function names a model this server can call; the reasoning-function guide says how it is written, and it may name tools that list_tool_servers lists. A workflow run answers started and ends later: read it with get_run until its status changes, and give a run that waits for input its event with send_run_event. Runs, history and events come a page at a time; read on only when the person needs more. When you tell the person what happened, say what was done and what they can do next, in the words of brains, functions, workflows and runs, not in the tools' names, fields or rules; give an id or a status only when the person needs it to act, as a run's id they will return to. A tool that cannot do what was asked says why and what to change.";

const recordWorkflowSentence =
  'A workflow run answers started and ends later: read it with get_run until its status changes, and give a run that waits for input its event with send_run_event.';

const recordRecallSentence =
  "A recall function keeps a view folded from the brain's own history, every run's start and ending with its result when it succeeded and fit, the definitions saved and every event published to the brain, never a run's input or the tool calls it made, so nothing has to write into it.";

const amendments: readonly (readonly [string, string])[] = [
  [recordWorkflowSentence, 'A run of a workflow answers started; get_run shows whether it ended or still waits.'],
  [", and every tool inside a brain takes the brain's id as brain.", '.'],
  [
    recordRecallSentence,
    "A recall function answers from what it keeps of the brain's own history: every run's start and end, with its result when it succeeded, the definitions saved and the events published to the brain, never a run's input or its tool calls, so nothing has to write into it.",
  ],
  ["made on the brain's own connection.", "made on the brain's own connection, /orgs/{org}/brains/{brain}/mcp."],
  [
    'names a model this server can call; the reasoning-function guide says how it is written, and it may name tools',
    'names a model this server can call, as the reasoning-function guide says, and may name tools',
  ],
  [", as a run's id they will return to.", '.'],
  [
    'may name tools that list_tool_servers lists.',
    'may name tools that list_tool_servers lists; test_tool_call shows what a tool answers.',
  ],
  [
    'list_models lists the models this server can call, which a reasoning function names. get_guide holds what these words mean and how each kind of definition is written.',
    'get_guide holds what these words mean and how each kind of definition is written. A reasoning function names a model that list_models lists and may name tools that list_tool_servers lists.',
  ],
];

function asServedWithFourTypes(recordText: string): string {
  return amendments.reduce((text, [recorded, served]) => text.replace(recorded, served), recordText);
}

const interactionSentence =
  'An interaction function asks a system and answers at once, or asks a person and answers started.';

const answeringSentence =
  "When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, in the shape its function's answer takes, and start no new run for it.";

function asServedWithFiveTypes(recordText: string): string {
  return asServedWithFourTypes(recordText)
    .replace(
      'A reasoning function has a prompt and calls a language model.',
      `A reasoning function has a prompt and calls a language model. ${interactionSentence}`,
    )
    .replace(
      'A run of a workflow answers started; get_run shows whether it ended or still waits.',
      `A run of a workflow answers started; get_run shows whether it ended or still waits. ${answeringSentence}`,
    )
    .replace('Runs, history and events come', 'Runs, history, events and requests come');
}

function withoutInteraction({ orgTools, brainTools }: ServedTools): ServedTools {
  return {
    orgTools,
    brainTools: brainTools.filter((name) => !name.endsWith('_interaction') && !name.endsWith('_interactions')),
  };
}

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
      const fourTypes = definitionTypes.filter(({ type }) => type !== 'interaction');

      expect(instructionsFor(endpoint, withoutInteraction(served), fourTypes, recipes)).toBe(
        asServedWithFourTypes(recordText),
      );
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
        'create_definition',
        'run_definition',
        'send_run_event',
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
      'get_guide holds what these words mean and how each kind of definition is written. A reasoning function names a model this server can call, as the reasoning-function guide says,',
    );
  });

  it('on an org endpoint that lists the models and no tool servers, say which models a reasoning function names', () => {
    const served = { orgTools: ['list_brains', 'list_models', 'get_guide'], brainTools: [] };

    expect(instructionsFor('org', served, definitionTypes, recipes)).toContain(
      'list_models lists the models this server can call, which a reasoning function names. get_guide holds',
    );
  });

  it('on an org endpoint that only creates brains, say that it makes a brain', () => {
    expect(instructionsFor('org', { orgTools: ['create_brain'], brainTools: [] }, definitionTypes, recipes)).toContain(
      "This connection manages the brains of one org: create_brain makes a brain, and a brain's functions and workflows are made on the brain's own connection, /orgs/{org}/brains/{brain}/mcp.",
    );
  });
});

describe('what the instructions say of the definition types', () => {
  it('give a sentence only to a type the server runs', () => {
    const reasoningAlone = definitionTypes.slice(0, 1);
    const instructions = instructionsFor('brain', brainEndpoint, reasoningAlone, recipes);

    expect(instructions).toContain('A reasoning function has a prompt and calls a language model.');
    expect(
      ['computation function', 'recall function', 'A workflow runs'].filter((words) => instructions.includes(words)),
    ).toEqual([]);
    expect(instructions).toContain('This connection acts inside one brain. Before writing a definition');
  });

  it('give no sentence to a type they have no words for', () => {
    const drafting = [{ type: 'drafting', noun: 'draft', guide: 'drafting' }];

    expect(instructionsFor('brain', brainEndpoint, drafting, recipes)).toContain(
      'A brain is the complete system for a business responsibility. It holds the functions that do its work and the workflows that coordinate them, and it keeps every run with its result as its history. This connection acts inside one brain. Before writing a definition',
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

describe('what the instructions say of a run that waits', () => {
  it('say how to answer what a run waits on only where answer_interaction is listed', () => {
    const answering = instructionsFor('brain', brainEndpoint, definitionTypes, recipes);
    const reading = instructionsFor(
      'brain',
      { orgTools: [], brainTools: queriesInsideABrain },
      definitionTypes,
      recipes,
    );

    expect(answering).toContain(answeringSentence);
    expect(reading).not.toContain('answer_interaction');
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

  it('use no term of the internal vocabulary once the address of a brain is taken out, and no product name', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) =>
      instructionsFor(endpoint, served, definitionTypes, recipes).replace(', /orgs/{org}/brains/{brain}/mcp.', '.'),
    );

    expect(instructions.flatMap((text) => internalTermsIn(text))).toEqual([]);
    expect(instructions.filter((text) => /\bauto\b|renamed/iu.test(text))).toEqual([]);
  });
});
