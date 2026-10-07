export type BrainFunctionKind = 'reason' | 'interact' | 'predict' | 'recall' | 'compute';

export const functionCategoryLabels = {
  reason: 'Reasoning',
  interact: 'Interaction',
  predict: 'Prediction',
  recall: 'Recall',
  compute: 'Computation',
} satisfies Record<BrainFunctionKind, string>;

export const functionResourceLabels = {
  reason: { singular: 'reasoning function', plural: 'reasoning functions' },
  interact: { singular: 'interaction function', plural: 'interaction functions' },
  predict: { singular: 'prediction function', plural: 'prediction functions' },
  recall: { singular: 'recall function', plural: 'recall functions' },
  compute: { singular: 'computation function', plural: 'computation functions' },
} satisfies Record<BrainFunctionKind, { readonly singular: string; readonly plural: string }>;

export const functionDescriptions = {
  reason: 'Use a prompt, skills, and tools to interpret information or produce a response.',
  interact: 'Exchange information with people or systems.',
  predict: 'Create and use an ML model to make predictions.',
  recall: 'Retrieve or reconstruct relevant information from configured sources.',
  compute: 'Run defined code or expressions to calculate or transform data.',
} satisfies Record<BrainFunctionKind, string>;

export const functionKindOrder: readonly BrainFunctionKind[] = ['reason', 'interact', 'predict', 'recall', 'compute'];

const resourceLabels: ReadonlyMap<string, string> = new Map([
  ['inference', functionResourceLabels.reason.singular],
  ['interaction', functionResourceLabels.interact.singular],
  ['computation', functionResourceLabels.compute.singular],
  ['recollection', functionResourceLabels.recall.singular],
  ['orchestration', 'workflow'],
]);

export function definitionResourceLabel(primitive: string): string {
  return resourceLabels.get(primitive) ?? `${primitive} definition`;
}
