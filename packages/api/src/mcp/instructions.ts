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
      'A brain works through specs: named, versioned documents, each written for one primitive, a kind of work the brain can do.',
      "The spec tools take the primitive by name, and their descriptions explain how each primitive's document is written.",
    ].join(' '),
  },
  {
    when: serves('execute_spec', 'get_execution'),
    text: [
      'execute_spec runs a spec and records the run as an execution.',
      'It may answer with status started while the work goes on; then poll get_execution until the status changes.',
    ].join(' '),
  },
  {
    when: serves('send_execution_event'),
    text: 'A workflow waiting for an event receives it through send_execution_event.',
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
  'Its tools are the operations inside that brain, such as defining, versioning, retiring and executing the specs of its primitives; it lists no tools when the server offers no primitive.',
  'Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns.',
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
].join(' ');
