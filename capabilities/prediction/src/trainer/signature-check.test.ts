import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parsePredictionDocument } from '../document/document-parsing.ts';
import type { TensorSignature } from '../facts/build-facts.ts';
import { dailyTotals, dailyVisits } from '../testing/daily-documents.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';
import { signatureIssue, type FoundSignature } from './signature-check.ts';

const visits = Result.getOrThrow(parsePredictionDocument(dailyVisits));

const orders = Result.getOrThrow(parsePredictionDocument(weeklyOrders));

const totals = Result.getOrThrow(parsePredictionDocument(dailyTotals));

const y: TensorSignature = { name: 'y', type: 'float32', shape: [1, 'L'] };

const q: TensorSignature = { name: 'q', type: 'float32', shape: [1, 'H', 3] };

const visitsModel: FoundSignature = { inputs: [y], outputs: [q], opset: 13 };

const ordersModel: FoundSignature = {
  inputs: [{ name: 'given', type: 'float32', shape: [1, 4, 1] }, { name: 'x', type: 'float32', shape: [1, 'L', 2] }, y],
  outputs: [{ name: 'q', type: 'float32', shape: [1, 4, 3] }],
  opset: 17,
};

const totalsModel: FoundSignature = {
  inputs: [y, { name: 'h', type: 'int64', shape: [1] }],
  outputs: [{ name: 'q', type: 'float32', shape: [1, 1, 3] }],
  opset: 13,
};

describe('the signature of a candidate a playbook takes', () => {
  it('is y, x when the data has features, given when it names some, and q, with its axes fixed or dynamic', () => {
    expect([
      signatureIssue(visits, visitsModel),
      signatureIssue(visits, {
        ...visitsModel,
        inputs: [{ ...y, shape: [1, 24] }],
        outputs: [{ ...q, shape: ['N', 2, 3] }],
      }),
      signatureIssue(orders, ordersModel),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it('is y and h of int64, answering q of a single step, for a function that predicts a total', () => {
    expect(signatureIssue(totals, totalsModel)).toBeUndefined();
  });
});

describe('a candidate whose signature a playbook does not take', () => {
  it('is told which names it has against the ones the playbook feeds', () => {
    expect([
      signatureIssue(visits, { ...visitsModel, inputs: [y, { name: 'extra', type: 'float32', shape: [1, 1] }] }),
      signatureIssue(visits, { ...visitsModel, outputs: [{ ...q, name: 'answer' }] }),
    ]).toEqual([
      "The model's inputs are [y, extra] and the playbook feeds [y]; export to the published signature",
      "The model's outputs are [answer] and the playbook feeds [q]; export to the published signature",
    ]);
  });

  it('is told which tensor has another type or axes than the one the playbook feeds', () => {
    expect([
      signatureIssue(visits, { ...visitsModel, inputs: [{ ...y, type: 'float64' }] }),
      signatureIssue(visits, { ...visitsModel, outputs: [{ ...q, shape: [1, 3, 3] }] }),
      signatureIssue(visits, { ...visitsModel, inputs: [{ ...y, shape: [1, 0] }] }),
      signatureIssue(orders, {
        ...ordersModel,
        inputs: [{ name: 'given', type: 'float32', shape: [1, 4, 2] }, ...ordersModel.inputs.slice(1)],
      }),
      signatureIssue(totals, { ...totalsModel, outputs: [{ ...q, shape: [1, 2, 3] }] }),
      signatureIssue(visits, { ...visitsModel, outputs: [{ name: 'q', type: 'non-tensor', shape: [] }] }),
    ]).toEqual([
      "The model's input y is float64 [1, L], where the playbook feeds float32 [1, L]; export to the published signature",
      "The model's output q is float32 [1, 3, 3], where the playbook feeds float32 [1, H, 3]; export to the published signature",
      "The model's input y is float32 [1, 0], where the playbook feeds float32 [1, L]; export to the published signature",
      "The model's input given is float32 [1, 4, 2], where the playbook feeds float32 [1, H, 1]; export to the published signature",
      "The model's output q is float32 [1, 2, 3], where the playbook feeds float32 [1, 1, 3]; export to the published signature",
      "The model's output q is non-tensor [], where the playbook feeds float32 [1, H, 3]; export to the published signature",
    ]);
  });

  it('is told its opset when it is older than 13', () => {
    expect(signatureIssue(visits, { ...visitsModel, opset: 12 })).toBe(
      "The model's opset is 12, and the playbook takes 13 or later",
    );
  });
});
