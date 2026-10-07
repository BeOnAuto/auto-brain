import { readFileSync } from 'node:fs';

import { listedTools, withMcpSession, type ListedTool, type McpSession } from '@beonauto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let tools: readonly ListedTool[];

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

beforeAll(async () => {
  server = await servingReasoning([]);
  tools = await onMcp(async (session) => listedTools(await session.listTools()));
});

afterAll(async () => {
  await server.stop();
});

const addressedToTheAgent = [
  /\bMUST\b/u,
  /\balways\b/iu,
  /\byou\b/iu,
  /(?:^|[.;:]\s+)(?:first|then|never)\b/iu,
  /\b(?:first|then)\s+(?:call|use|run|read|ask|check|create|list|get|give|tell|poll)\b/iu,
  /\b(?:call|use|run|read)\s+\S+\s+first\b/iu,
];

const anyJsonValue: ReadonlySet<string> = new Set(['input', 'answer']);

const PropertiesSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
});

const propertiesOf = Schema.decodeUnknownSync(PropertiesSchema);

interface Argument {
  readonly where: string;
  readonly name: string;
  readonly keywords: readonly string[];
  readonly description: unknown;
}

function argumentsOf({ name: tool, inputSchema }: ListedTool): readonly Argument[] {
  const { properties = {} } = propertiesOf(inputSchema);
  return Object.entries(properties).map(([name, property]: readonly [string, Readonly<Record<string, unknown>>]) => ({
    where: `${tool}.${name}`,
    name,
    keywords: Object.keys(property).filter((keyword) => keyword !== 'description'),
    description: property['description'],
  }));
}

function sentencesOf(text: string): number {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`])/u).length;
}

function isOutsideTheSentenceBound({ description = '' }: ListedTool): boolean {
  return sentencesOf(description) < 3 || sentencesOf(description) > 8;
}

function isAddressedToTheAgent({ description = '' }: ListedTool): boolean {
  return addressedToTheAgent.some((pattern: Readonly<RegExp>) => pattern.test(description));
}

function isUndescribedOrLong({ description }: Argument): boolean {
  return typeof description !== 'string' || description.length >= 300;
}

function hasNoConstraint({ name, keywords }: Argument): boolean {
  return keywords.length === 0 && !anyJsonValue.has(name);
}

describe('the descriptions of the tools of /mcp', () => {
  it('are twenty-four, each under 800 characters, in three to eight sentences', () => {
    expect(tools).toHaveLength(24);
    expect(tools.filter(({ description = '' }) => description.length >= 800).map(({ name }) => name)).toEqual([]);
    expect(tools.filter((tool) => isOutsideTheSentenceBound(tool)).map(({ name }) => name)).toEqual([]);
  });

  it('carry no format, no catalogue of refusals and nothing addressed to the agent but when to use the tool', () => {
    expect(
      tools.filter(({ description = '' }) => /Rejected with|^---$/mu.test(description)).map(({ name }) => name),
    ).toEqual([]);
    expect(tools.filter((tool) => isAddressedToTheAgent(tool)).map(({ name }) => name)).toEqual([]);
  });

  it('name each type of definition with the kind it is and its guide, in create_spec', () => {
    const createSpec = tools.find(({ name }) => name === 'create_spec');

    expect(createSpec?.description).toContain(
      'inference, a reasoning function, guide reasoning-function; interaction, an interaction function, guide interaction-function; computation, a computation function, guide computation-function; recollection, a recall function, guide recall-function; orchestration, a workflow, guide workflow.',
    );
  });
});

function everyArgument(): readonly Argument[] {
  return tools.flatMap((tool) => argumentsOf(tool));
}

describe('the arguments of the tools of /mcp', () => {
  it('each have a description under 300 characters', () => {
    expect(everyArgument().length).toBeGreaterThan(60);
    expect(
      everyArgument()
        .filter((argument) => isUndescribedOrLong(argument))
        .map(({ where }) => where),
    ).toEqual([]);
    expect(Math.max(...everyArgument().map(({ description }) => String(description).length))).toBeLessThan(200);
  });

  it('each give their constraints as keywords, but an argument that takes any JSON value', () => {
    expect(
      everyArgument()
        .filter((argument) => hasNoConstraint(argument))
        .map(({ where }) => where),
    ).toEqual([]);
  });
});

type Hints = readonly [boolean, boolean, boolean, boolean];

const served: Readonly<Record<string, Hints>> = {
  create_brain: [false, false, false, false],
  list_brains: [true, false, true, false],
  get_brain: [true, false, true, false],
  update_brain: [false, false, true, false],
  retire_brain: [false, true, true, false],
  list_models: [true, false, true, true],
  create_spec: [false, false, false, false],
  list_specs: [true, false, true, false],
  get_spec: [true, false, true, false],
  update_spec: [false, false, true, false],
  retire_spec: [false, true, true, false],
  execute_spec: [false, false, false, true],
  get_execution: [true, false, true, false],
  cancel_execution: [false, true, true, false],
  list_executions: [true, false, true, false],
  get_execution_history: [true, false, true, false],
  get_brain_analytics: [true, false, true, false],
  list_brain_events: [true, false, true, false],
  publish_event: [false, false, false, false],
  list_tool_servers: [true, false, true, true],
  answer_interaction: [false, true, true, false],
  list_interactions: [true, false, true, false],
  send_execution_event: [false, false, false, false],
  get_guide: [true, false, true, false],
};

function hintsOf({ annotations = {} }: ListedTool): Hints {
  return [
    annotations['readOnlyHint'] === true,
    annotations['destructiveHint'] === true,
    annotations['idempotentHint'] === true,
    annotations['openWorldHint'] === true,
  ];
}

const apiReadme = readFileSync(new URL('../../../api/README.md', import.meta.url), 'utf8');

const readmeRow = /^\| `([a-z_]+)` +\| (true|false) +\| (true|false) +\| (true|false) +\| (true|false) +\|$/gmu;

function rowOf([, name = '', readOnly, destructive, idempotent, openWorld]: readonly string[]): readonly [
  string,
  Hints,
] {
  return [name, [readOnly === 'true', destructive === 'true', idempotent === 'true', openWorld === 'true']];
}

describe('the annotations of the tools of /mcp', () => {
  it('say which tools only read, which cannot be undone, which may be repeated and which reach outside', () => {
    expect(Object.fromEntries(tools.map((tool) => [tool.name, hintsOf(tool)]))).toEqual(served);
  });

  it('are those the table of the api README gives', () => {
    expect(Object.fromEntries([...apiReadme.matchAll(readmeRow)].map((row: readonly string[]) => rowOf(row)))).toEqual(
      served,
    );
  });
});
