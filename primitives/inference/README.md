# @beonauto/inference

The implementation of reasoning functions. It parses each source document into a `ReasoningFunctionDefinitionDocument`, including model settings and the compiled prompt template. The named, versioned `ReasoningFunctionDefinition` is stored separately by `@beonauto/specs`. Its API identifier and package name are `inference`.

User documentation starts with [Reasoning function format](../../docs/reference/reasoning-format.md), published at [on.auto/docs](https://on.auto/docs/). The repository-only [complete format](../../docs/engineering/reference/reasoning-format.md) and [Model providers and gateways](../../docs/engineering/self-host/models.md) retain contributor details. Update the relevant files alongside behavior changes.

## Using it from code

```ts
import { compileAnswerSchema, LanguageModel, languageModelLayer } from '@beonauto/inference';
import { Effect, Result } from 'effect';

const schema = Result.getOrThrow(
  compileAnswerSchema({
    type: 'object',
    properties: { verdict: { enum: ['approve', 'reject'] } },
    required: ['verdict'],
    additionalProperties: false,
  }),
);

const decide = Effect.gen(function* () {
  const model = yield* LanguageModel;
  return yield* model.generate({
    model: 'anthropic/claude-sonnet-4-5',
    instructions: 'Decide whether the expense follows the policy.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Dinner for four, 312 EUR, client present.' }] }],
    output: { type: 'json', schema, name: 'verdict' },
    settings: { max_output_tokens: 200 },
    timeout_ms: 30_000,
  });
});

Effect.runPromise(decide.pipe(Effect.provide(languageModelLayer(process.env))));
```

A request has `model`, optional `instructions`, `messages` (roles `user` and `assistant`, each with text parts), `output`, `settings` (`max_output_tokens`, and optionally `temperature`, `top_p`, `seed`, `stop_sequences` and `reasoning`), optional `provider_options`, `timeout_ms`, `signal` and `retries`. Some providers drop sampling settings for newer models and say so in `warnings`. `provider_options` passes options to the provider, keyed by the AI SDK's namespace for it: `anthropic`, `openai`, `azure`, `google`, `vertex`, `googleVertex`, `amazonBedrock`, `bedrock`, or the gateway's name. A call fails as `spec_invalid` before any provider is called when it holds a namespace no configured provider reads, or an option for a gateway its `allowed_provider_options` does not list; which options of the built-in providers a spec may set is checked when the spec is parsed (see [Provider options](../../docs/engineering/reference/reasoning-format.md#provider-options)). `requestIssues(request)` gives the problems of a request before it is sent, and the model's `admit(request)` everything `generate` would refuse before calling a provider: those problems, a model that resolves to no configured provider or is not allowed, and provider options that are not allowed.

`makeModelAccess(settings, options)` builds the same model and also returns `status`, and the `catalog` that [`list_models`](../../docs/engineering/self-host/models.md#listing-the-models) reads, whose `list(provider?)` gives the list. Its options inject a `fetch` and credential sources (`aws`, `google`, `azure`), which is how tests run without a network and how per-tenant credentials will be added, `reportProviderMessage`, which receives the [provider messages](../../docs/engineering/self-host/models.md#provider-messages) a caller does not see, and `reportOperatorHint`, which receives the [operator hints](../../docs/engineering/self-host/models.md#operator-hints). A request may carry an `execution_id`, which only those reports use; the reasoning function adapter sets it to the execution's id.

## Tools

A reasoning function whose front matter names `tools` (each `server/tool`, or `server/*`) runs with the tools of the MCP servers configured for its brain, as [decision 0003](../../docs/decisions/0003-mcp-servers.md) sets out. `makeReasoningFunctionAdapter` takes the server's `ToolAccess` from [`@beonauto/mcp`](../../packages/mcp) as `tools`, as a type only: it imports the helpers it needs to parse `tools` and bound a run from `@beonauto/mcp/policy`, which loads no transport code; without one, or with no server configured, a function that names tools is rejected as `unavailable`, kind `tool_not_offered`. The adapter then says it may change something outside (`mayChangeOutside`), so `execute_spec` is destructive.

A function that names tools calls tools (`callsTools`), so the start of its run records that, and a run of it that is still `started` is not run again under its id. An execution first admits its request with the model's `admit`, so a run whose model is not offered reaches no server and starts no process; it then opens its tools with its id, org, brain and journal before the model is called, and rejects as `unavailable` with kind `tool_not_offered` (because `mcp_server_not_configured`, `tool_not_allowed` or `tool_not_listed`) or `mcp_server_failed` (because `unreachable`, `failing` or `rate_limited`). Otherwise the request carries `tools`: the offered tools under their model-facing names with their input schemas unchanged, whether the calls have ended, a signal that ends them, and the bound of the whole run. In the adapter, the AI SDK's loop:

- gives the model the tools in the function's own output mode, text or JSON, and returns each answer to the model as a tool result, an error result for a tool error;
- gives every model call its own deadline, the request's `timeout_ms`, which the time the tools take does not count against, armed when the call starts and ended however it settles, even when the AI SDK reports no end for a call that threw, and bounds the whole run by ten minutes, or one call's deadline when that is longer;
- once the run's calls have ended, runs one more step with the tools withheld and the conversation told again as text, since some providers refuse tool messages without the tools' definitions, so the model answers from what it has: the calls in words, and their answers inside a block fenced by 32 random hexadecimal characters drawn for that step, once every result is known, and labelled as the results of the tools the model called, data to answer from and neither instructions nor the user's words, so no result can close the block or pass for the user;
- fails as `tools_stopped` when that last step still calls tools (`no_answer`), when the run reaches its bound (`run_bound`), or when its tool servers failed too often (`server_failed`);
- adds to the result's `warnings`, after the provider's, one `compatibility` warning for each place in a tool's input schema where the provider of the run's model may refuse the schema or not hold the tool's arguments to it, named as the tool's name, `inputSchema#` and the JSON pointer, such as `mcp__graph__search inputSchema#/properties/query/maxLength`. The rules are those of a JSON output schema (`src/schema/schema-portability.ts`) that hold for a tool's arguments: a root that is not an object, and for Anthropic models the bounds and `oneOf` they do not enforce and the formats they do not accept, each worded for a tool's arguments. The rules for open objects and optional properties bind strict structured outputs only, and the AI SDK sends tools as not strict (`@ai-sdk/openai` 4.0.83 sets `strict: false` unless a tool asks), so they are left out. A schema of more than 64 KiB or 64 levels is not checked.

Once a run has recorded a tool call, every `unavailable` ending it meets has the kind `tools_unfinished`, with because `server_failed`, `model_unavailable`, `run_bound` or `no_answer`, and words that name the tools it called in words, never as `server/tool`, and never ask to try again. The run's sessions end however it ends.

A run that calls tools costs more: every step resends the conversation so far, so a run that uses its whole budget of 256 KiB of results sends on the order of a million tokens.

## What a rejection records

Some rejections come after the model answered, and so after it spent tokens: `output_invalid`, an answer that does not match the schema or is cut off at `max_output_tokens`; `content_refused` from the answer's finish; `tools_stopped` with `no_answer`, whose last step still called tools; and an answer that leaves no room in what a run records. Each of their `InvalidInput`, `Unavailable` or `Conflict` carries a `record` of `usage`, shaped as in the record of a run that succeeded, and `duration_ms`, measured with Effect's `Clock` from the model call to the rejection, or the call's own duration for an answer too large to record; `@beonauto/specs` keeps it on the run's `execution_rejected`. A failure that knows no usage, such as a deadline, the bound of a run that calls tools or tool servers that kept failing, whose SDK call threw, carries none.

## Testing

`makeReasoningFunctionAdapter({ languageModel, offered, clock, tools })` makes the runtime adapter for `makeSpecOperations`; the server gives it the language model and offered-model configuration from `makeModelAccess`, plus its `ToolAccess`, and a test the scripted model below. `ReasoningFunctionAdapterOptions` names its options. `clock` is optional: without it, `today` and `now` come from Effect's `Clock`.

`@beonauto/inference/testing` exports a fake for the tests of other packages. `callingTools(calls, then)` scripts a model that calls tools before its reply, as the adapter does, with a signal that aborts when the call is interrupted. `scriptedLanguageModel(...replies)` answers with its replies in order, admits and rejects an invalid request as the real one does, records every request (`requests()`), and provides itself as a `layer`. A reply is a function of the request; `answers(textResult('Hello'))` and `answers(jsonResult({ verdict: 'approve' }))` build the usual ones, and `() => Effect.fail(new RateLimited({ ... }))` scripts a failure.

No test in this package calls a model: the adapter is tested with the AI SDK's mock model and with the real provider packages against a fake `fetch` that answers with each provider's documented response shape.

## Source

`src/index.ts` is the entry point and `src/testing/index.ts` the entry point of the test support. `src/model` holds the interface: the request, the result, the `LanguageModel` service and the request checks. `src/failure` holds one class per failure. `src/schema` holds answer schemas: limits, the shape check, compilation, validation and portability. `src/settings` reads the settings from the environment with Effect `Config`. `src/adapter` and `src/tools` are the only production code that imports the AI SDK, and `src/adapter` the only code that imports the cloud credential libraries. `src/listing` reads the list of models of each provider, and `src/catalog` keeps the lists, combines them with the declared models and the aliases, applies the allow list, and defines `list_models`. `src/template` is the only code that imports liquidjs: the configured engine, the filters, the system block, compiling and rendering, behind readonly types of its own. `src/spec` parses and validates a spec document: the split, the YAML, the front matter, the settings, the schemas and the variables a template reads. `src/tools` gives the model a run's tools: the tools as the AI SDK takes them, the last step without them, opening a run's tools and its endings. `src/primitive` is the primitive: its description, preparing the input, rendering the prompt, the request, the answer, the rejections and the record. `src/testing` holds the fake and what the tests share, including the SDK's mock model.
