import { describe, expect, it } from 'vitest';

import {
  definitionResourceLabel,
  functionCategoryLabels,
  functionDescriptions,
  functionKindOrder,
  functionResourceLabels,
} from '../index.ts';

describe('brain function terminology', () => {
  it('keeps the five function types in product order, without coordination or Dream', () => {
    expect(functionKindOrder).toEqual(['reason', 'interact', 'predict', 'recall', 'compute']);
    expect(functionKindOrder.map((kind) => functionCategoryLabels[kind])).toEqual([
      'Reasoning',
      'Interaction',
      'Prediction',
      'Recall',
      'Computation',
    ]);
    expect(Object.keys(functionCategoryLabels)).toEqual(functionKindOrder);
    expect(Object.keys(functionResourceLabels)).toEqual(functionKindOrder);
    expect(Object.keys(functionDescriptions)).toEqual(functionKindOrder);
  });

  it('uses countable resource names and describes each declared responsibility', () => {
    expect(functionKindOrder.map((kind) => functionResourceLabels[kind])).toEqual([
      { singular: 'reasoning function', plural: 'reasoning functions' },
      { singular: 'interaction function', plural: 'interaction functions' },
      { singular: 'prediction function', plural: 'prediction functions' },
      { singular: 'recall function', plural: 'recall functions' },
      { singular: 'computation function', plural: 'computation functions' },
    ]);
    expect(functionKindOrder.map((kind) => functionDescriptions[kind])).toEqual([
      'Use a prompt, skills, and tools to interpret information or produce a response.',
      'Exchange information with people or systems.',
      'Create and use an ML model to make predictions.',
      'Retrieve or reconstruct relevant information from configured sources.',
      'Run defined code or expressions to calculate or transform data.',
    ]);
  });

  it('labels known resources without reclassifying custom runtime adapters as functions', () => {
    expect(definitionResourceLabel('inference')).toBe('reasoning function');
    expect(definitionResourceLabel('computation')).toBe('computation function');
    expect(definitionResourceLabel('orchestration')).toBe('workflow');
    expect(definitionResourceLabel('echo')).toBe('echo definition');
    expect(definitionResourceLabel('agent')).toBe('agent definition');
  });
});
