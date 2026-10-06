export const orgEndpointInstructions = [
  'This MCP endpoint serves one org of auto-brain, the runtime for business brains.',
  'Its tools are the operations on the org as a whole, such as creating, listing, reading, updating and retiring its brains.',
  'Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns.',
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
].join(' ');

export interface ServedTools {
  readonly orgTools: readonly string[];
  readonly brainTools: readonly string[];
}

interface Orientation {
  readonly when: (served: ServedTools) => boolean;
  readonly text: string;
}

function serves(...names: readonly string[]): (served: ServedTools) => boolean {
  return ({ orgTools, brainTools }) => names.every((name) => orgTools.includes(name) || brainTools.includes(name));
}

const orientation: readonly Orientation[] = [
  { when: () => true, text: 'This server runs the business brains of your org.' },
  {
    when: serves('list_brains', 'create_brain'),
    text: 'Start with list_brains to see them, or create_brain to make one.',
  },
  {
    when: serves('create_spec'),
    text: [
      'A brain uses named, versioned definitions, called specs in this API.',
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
    text: 'Workflows coordinate the work. A waiting workflow run receives input through send_execution_event.',
  },
  {
    when: ({ brainTools }) => brainTools.length > 0,
    text: "Every tool that works inside a brain takes the brain's id as brain.",
  },
  {
    when: () => true,
    text: 'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
  },
];

export function catalogInstructionsFor(served: ServedTools): string {
  return orientation
    .filter(({ when }) => when(served))
    .map(({ text }) => text)
    .join(' ');
}

export const brainEndpointInstructions = [
  'This MCP endpoint serves one brain of an org in auto-brain, the runtime for business brains.',
  'Its tools define, version, retire and run functions and workflows in this brain; it lists no tools when no definition types are configured.',
  'Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns.',
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
].join(' ');
