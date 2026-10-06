import { detailsOf } from './view-documents.ts';

const reviewsFold = [
  '($event.data.output | if type == "object" then .campaign else null end | if type == "string" then . else "unknown" end) as $campaign',
  '| .[$campaign] += [{ at: $event.time, verdict: ($event.data.output.verdict? // "none" | tostring | .[0:200]), run: $event.source }]',
  '| .[$campaign] |= .[-20:]',
  '| to_entries | sort_by(.value[-1].at) | .[-50:] | from_entries',
].join('\n');

const reviewFilters = [{ type: 'execution_succeeded', subject: 'inference/review-brief' }];

const reviewsSchema = {
  type: 'object',
  maxProperties: 50,
  additionalProperties: { type: 'array', maxItems: 20 },
};

export const campaignReviews = detailsOf(reviewsFold, reviewFilters, {
  schema: reviewsSchema,
  answer: '.[$input.campaign] // [] | .[-($input.last // 5):]',
});
