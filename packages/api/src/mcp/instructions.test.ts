import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { internalTermsIn } from '../testing/internal-terms.ts';
import { instructionsFor, type DefinitionType, type McpEndpoint, type ServedTools } from './instructions.ts';

const brainTools = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

const specTools = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
];

const orgEndpoint: ServedTools = { orgTools: [...brainTools, 'list_models'], brainTools: [] };

const brainEndpoint: ServedTools = { orgTools: [], brainTools: [...specTools, 'send_execution_event'] };

const ownOrg: ServedTools = { orgTools: orgEndpoint.orgTools, brainTools: brainEndpoint.brainTools };

const definitionTypes: readonly DefinitionType[] = [
  { primitive: 'inference', noun: 'reasoning function' },
  { primitive: 'computation', noun: 'computation function' },
  { primitive: 'recollection', noun: 'recall function' },
  { primitive: 'orchestration', noun: 'workflow' },
];

const everyEndpoint: readonly (readonly [McpEndpoint, ServedTools])[] = [
  ['org', orgEndpoint],
  ['brain', brainEndpoint],
  ['own org', ownOrg],
];

const concepts = [
  'A brain is the complete system for a business responsibility.',
  'It belongs to an org and holds functions, which do its work, and workflows, which coordinate them.',
  'A function or a workflow is a reusable definition, and a run executes it on an input.',
  'A reasoning function has a prompt and calls a language model.',
  'Until they are renamed, the tools say spec for a definition and execution for a run.',
  'When you answer the person, say in a sentence or two what was done and what they can do next, in the words of brains, functions, workflows and runs, and leave ids, statuses and the rules of this server out unless they ask.',
].join(' ');

const closing =
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.';

const terminology = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

function definitionOfABrainOnTheTerminologyPage(): string {
  const [, definition = ''] =
    /^\| Brain +\| (The complete system for a business responsibility),/mu.exec(terminology) ?? [];
  return definition;
}

describe("the instructions of /mcp, the endpoint of the caller's own org", () => {
  it('say what a brain is, then orient an agent to the brains, definitions, runs and workflows it serves', () => {
    expect(instructionsFor('own org', ownOrg, definitionTypes)).toBe(
      [
        concepts,
        "This connection acts in the caller's own org.",
        "Start with list_brains to see the org's brains, or create_brain to make one.",
        'A spec is a named, versioned definition in a brain.',
        'The primitive field selects a definition type, inference for a reasoning function, computation for a computation function, recollection for a recall function or orchestration for a workflow; each tool describes its supported document formats.',
        'list_models lists the models this server can call.',
        'execute_spec runs a definition and records its run; execution_id identifies it.',
        'It may answer with status started while the work goes on; then poll get_execution until the status changes.',
        'A waiting workflow run receives input through send_execution_event.',
        "Every tool that works inside a brain takes the brain's id as brain.",
        closing,
      ].join(' '),
    );
  });

  it('name the one definition type it serves, with the article its kind takes, and none when it serves none', () => {
    const interacting = [{ primitive: 'interaction', noun: 'interaction function' }];

    expect(instructionsFor('own org', ownOrg, interacting)).toContain(
      'The primitive field selects a definition type, interaction for an interaction function; each tool',
    );
    expect(instructionsFor('own org', ownOrg, [])).toContain(
      'The primitive field selects a definition type; each tool describes its supported document formats.',
    );
  });

  it('say nothing of workflows or of the models when it does not serve their tools', () => {
    const instructions = instructionsFor('own org', { orgTools: brainTools, brainTools: specTools }, definitionTypes);

    expect(instructions).not.toContain('send_execution_event');
    expect(instructions).not.toContain('list_models');
  });

  it('say only what holds for every endpoint when it serves nothing', () => {
    expect(instructionsFor('own org', { orgTools: [], brainTools: [] }, definitionTypes)).toBe(
      `${concepts} This connection acts in the caller's own org. ${closing}`,
    );
  });
});

describe('the instructions of a scoped endpoint', () => {
  it('on the endpoint of an org, name the tools of its brains and models, and none that work inside a brain', () => {
    expect(instructionsFor('org', orgEndpoint, definitionTypes)).toBe(
      [
        concepts,
        'This connection manages the brains of one org.',
        "Start with list_brains to see the org's brains, or create_brain to make one.",
        'list_models lists the models this server can call.',
        closing,
      ].join(' '),
    );
  });

  it('on the endpoint of a brain, name the tools that work inside it, and never one it does not serve', () => {
    const instructions = instructionsFor('brain', brainEndpoint, definitionTypes);

    expect(instructions).toContain('This connection acts inside one brain.');
    expect(instructions).toContain('orchestration for a workflow; each tool describes its supported document formats.');
    expect(instructions).toContain('then poll get_execution until the status changes.');
    expect(instructions).toContain('A waiting workflow run receives input through send_execution_event.');
    expect(
      ['create_brain', 'list_brains', 'list_models', 'takes the brain'].filter((name) => instructions.includes(name)),
    ).toEqual([]);
  });
});

describe('the instructions of every endpoint', () => {
  it.each(everyEndpoint)('stay under 1,600 characters on the %s endpoint', (endpoint, served) => {
    expect(instructionsFor(endpoint, served, definitionTypes).length).toBeLessThan(1600);
  });

  it('use no term of the internal vocabulary but the wire names they explain, and no product name', () => {
    const instructions = instructionsFor('own org', ownOrg, definitionTypes);

    expect(internalTermsIn(instructions)).toEqual(['spec', 'primitive', 'execution', 'inference', 'orchestration']);
    expect(instructions).not.toMatch(/\bauto\b/iu);
  });

  it('open with the definition of a brain the terminology page gives, on every endpoint', () => {
    const definition = definitionOfABrainOnTheTerminologyPage();

    expect(definition).toBe('The complete system for a business responsibility');
    expect(
      everyEndpoint.filter(
        ([endpoint, served]) =>
          !instructionsFor(endpoint, served, definitionTypes).startsWith(`A brain is ${definition.toLowerCase()}.`),
      ),
    ).toEqual([]);
  });
});
