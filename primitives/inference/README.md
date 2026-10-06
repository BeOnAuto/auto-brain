# @beonauto/inference

The implementation of reasoning functions. It parses each source document into a `ReasoningFunctionDefinitionDocument`, including model settings and the compiled prompt template. The named, versioned `ReasoningFunctionDefinition` is stored separately by `@beonauto/specs`. The API identifier and package name remain `inference` for compatibility.

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

A request has `model`, optional `instructions`, `messages` (roles `user` and `assistant`, each with text parts), `output`, `settings` (`max_output_tokens`, and optionally `temperature`, `top_p`, `seed`, `stop_sequences` and `reasoning`), optional `provider_options`, `timeout_ms`, `signal` and `retries`. Some providers drop sampling settings for newer models and say so in `warnings`. `provider_options` passes options to the provider, keyed by the AI SDK's namespace for it: `anthropic`, `openai`, `azure`, `google`, `vertex`, `googleVertex`, `amazonBedrock`, `bedrock`, or the gateway's name. A call fails as `spec_invalid` before any provider is called when it holds a namespace no configured provider reads, or an option for a gateway its `allowed_provider_options` does not list; which options of the built-in providers a spec may set is checked when the spec is parsed (see [Provider options](../../docs/engineering/reference/reasoning-format.md#provider-options)). `requestIssues(request)` gives the problems of a request before it is sent.

`makeModelAccess(settings, options)` builds the same model and also returns `status`, and the `catalog` that [`list_models`](../../docs/engineering/self-host/models.md#listing-the-models) reads, whose `list(provider?)` gives the list. Its options inject a `fetch` and credential sources (`aws`, `google`, `azure`), which is how tests run without a network and how per-tenant credentials will be added, `reportProviderMessage`, which receives the [provider messages](../../docs/engineering/self-host/models.md#provider-messages) a caller does not see, and `reportOperatorHint`, which receives the [operator hints](../../docs/engineering/self-host/models.md#operator-hints). A request may carry an `execution_id`, which only those reports use; the reasoning function adapter sets it to the execution's id.

## Testing

`makeReasoningFunctionAdapter({ languageModel, offered, clock })` makes the runtime adapter for `makeSpecOperations`; the server gives it the language model and offered-model configuration from `makeModelAccess`, and a test the scripted model below. `ReasoningFunctionAdapterOptions` names its options. `clock` is optional: without it, `today` and `now` come from Effect's `Clock`. The exports `makeInference` and `InferenceOptions` remain aliases for existing consumers.

`@beonauto/inference/testing` exports a fake for the tests of other packages. `scriptedLanguageModel(...replies)` answers with its replies in order, rejects an invalid request as the real one does, records every request (`requests()`), and provides itself as a `layer`. A reply is a function of the request; `answers(textResult('Hello'))` and `answers(jsonResult({ verdict: 'approve' }))` build the usual ones, and `() => Effect.fail(new RateLimited({ ... }))` scripts a failure.

No test in this package calls a model: the adapter is tested with the AI SDK's mock model and with the real provider packages against a fake `fetch` that answers with each provider's documented response shape.

## Source

`src/index.ts` is the entry point and `src/testing/index.ts` the entry point of the test support. `src/model` holds the interface: the request, the result, the `LanguageModel` service and the request checks. `src/failure` holds one class per failure. `src/schema` holds answer schemas: limits, the shape check, compilation, validation and portability. `src/settings` reads the settings from the environment with Effect `Config`. `src/adapter` is the only production code that imports the AI SDK and the cloud credential libraries. `src/listing` reads the list of models of each provider, and `src/catalog` keeps the lists, combines them with the declared models and the aliases, applies the allow list, and defines `list_models`. `src/template` is the only code that imports liquidjs: the configured engine, the filters, the system block, compiling and rendering, behind readonly types of its own. `src/spec` parses and validates a spec document: the split, the YAML, the front matter, the settings, the schemas and the variables a template reads. `src/primitive` is the primitive: its description, preparing the input, rendering the prompt, the request, the rejections and the record. `src/testing` holds the fake and what the tests share, including the SDK's mock model.
