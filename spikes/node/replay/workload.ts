import type { JsonObject } from '../../../primitives/orchestration/src/dsl/json.ts';
import type { SpecCall, SpecCallResult } from '../../../primitives/orchestration/src/interpreter/host.ts';
import type { WorkflowRun } from '../../../primitives/orchestration/src/interpreter/workflow-run.ts';
import { runFor, yamlObject } from '../../../primitives/orchestration/src/testing/workflows.ts';
import type { Input, LogEngine } from './log-host.ts';

export const scoreOrders = yamlObject(`
document:
  dsl: '1.0.3'
  namespace: acme
  name: score-orders
  version: '1.0.0'
use:
  retries:
    patient:
      delay: { seconds: 2 }
      backoff: { exponential: {} }
      limit:
        attempt: { count: 4 }
do:
  - prepare:
      set:
        customer: '\${ .customer }'
        pages: '\${ [range(0; .pages)] }'
        totals: { scored: 0, flagged: 0, amount: 0, escalated: 0 }
        recent: []
  - process:
      for:
        in: '\${ .pages }'
        each: page
      do:
        - batches:
            for:
              in: '\${ [range(0; 100)] }'
              each: item
            do:
              - shape:
                  set:
                    customer: '\${ .customer }'
                    totals: '\${ .totals }'
                    recent: '\${ .recent }'
                    request:
                      batch: '\${ $page * 100 + $item }'
                      customer: '\${ .customer.id }'
                      region: '\${ .customer.region | ascii_upcase }'
                      segments: '\${ [.recent[] | .category] | unique }'
                      trailing: '\${ [.recent[] | .score] | if length > 0 then add / length else 0 end }'
                      note: '\${ "batch " + ($page * 100 + $item | tostring) + " for " + .customer.id + " (" + .customer.tier + ")" }'
              - score:
                  try:
                    - classify:
                        call: execute_spec
                        with:
                          primitive: inference
                          name: score-batch
                          input: '\${ .request }'
                        timeout:
                          after: { minutes: 5 }
                        output:
                          as: '\${ $input + { result: . } }'
                  catch:
                    errors:
                      with: { status: 503 }
                    retry: patient
              - accumulate:
                  set:
                    customer: '\${ .customer }'
                    recent: '\${ (.recent + [{ batch: ($page * 100 + $item), category: .result.category, score: .result.score }]) | .[-16:] }'
                    totals: '\${ .totals | .scored += 1 | .amount += ($input.result.amount // 0) | .flagged += (if $input.result.score > 0.8 then 1 else 0 end) }'
                    labels: '\${ [.result.labels[] | select(startswith("P") or startswith("B")) | ascii_downcase] }'
              - route:
                  switch:
                    - risky:
                        when: '\${ .recent[-1].score > 0.95 }'
                        then: escalate
                    - fine:
                        then: pace
              - escalate:
                  set:
                    customer: '\${ .customer }'
                    recent: '\${ .recent }'
                    labels: '\${ .labels }'
                    totals: '\${ .totals | .escalated += 1 }'
              - pace:
                  wait: { seconds: 30 }
              - review:
                  if: '\${ $item % 50 == 49 }'
                  listen:
                    to:
                      one:
                        with:
                          type: com.acme.review.approved
                  output:
                    as: '\${ $input + { approval: .[0] } }'
`);

export const runInput = { customer: { id: 'c-1042', region: 'emea', tier: 'gold' }, pages: 250 };

export function scoreOrdersRun(): WorkflowRun {
  return runFor(scoreOrders, '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', runInput);
}

const categories = ['retail', 'wholesale', 'marketplace', 'subscription', 'refund'];

const summary =
  'The batch is consistent with the customer history: no unusual amounts, two repeat buyers, one new shipping address.';

export function respond(call: SpecCall, count: number): SpecCallResult {
  if (count % 37 === 36) {
    return { status: 'rejected', reason: 'unavailable', detail: 'The model provider is overloaded; try again later' };
  }
  return {
    status: 'succeeded',
    output: {
      category: categories[count % categories.length] ?? 'retail',
      score: ((count * 7919) % 1000) / 1000,
      amount: (count % 97) * 12.5,
      confidence: 0.91,
      labels: ['Priority', 'B2B', 'repeat', 'Bulk', 'eu-vat'],
      summary,
      echo: call.reference,
      usage: { input_tokens: 812, output_tokens: 64 },
    },
  };
}

function approval(count: number): JsonObject {
  return {
    id: `review-${count}`,
    type: 'com.acme.review.approved',
    source: 'https://acme.example/reviews',
    data: { reviewer: 'r-7', approved: true, note: 'Looked at the flagged batches; all fine.' },
  };
}

const callLatencyMs = 1_500;

const eventAfterMs = 60_000;

interface Candidate {
  readonly at: number;
  readonly order: number;
  readonly make: () => Input;
}

export interface World {
  readonly next: (engine: LogEngine) => Input | undefined;
}

export function world(): World {
  let calls = 0;
  let events = 0;
  const candidatesOf = (engine: LogEngine): readonly Candidate[] =>
    engine.waiting().flatMap((entry): readonly Candidate[] => {
      if (entry.kind === 'timer') {
        return [{ at: entry.dueAt, order: entry.seq, make: () => ({ k: 'timer', seq: entry.seq, at: entry.dueAt }) }];
      }
      if (entry.kind === 'call') {
        const at = entry.issuedAt + callLatencyMs;
        return [
          {
            at,
            order: entry.seq,
            make: () => {
              calls += 1;
              return { k: 'result', seq: entry.seq, at, result: respond(entry.call, calls) };
            },
          },
        ];
      }
      if (entry.listens) {
        const at = entry.since + eventAfterMs;
        return [
          {
            at,
            order: entry.seq,
            make: () => {
              events += 1;
              return { k: 'event', at, event: approval(events) };
            },
          },
        ];
      }
      return [];
    });
  return {
    next: (engine) => {
      const [earliest] = candidatesOf(engine).toSorted((left, right) =>
        left.at === right.at ? left.order - right.order : left.at - right.at,
      );
      return earliest?.make();
    },
  };
}
