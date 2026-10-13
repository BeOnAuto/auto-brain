# 24. Telemetry: how the work happened, over OpenTelemetry, beside the ledger that records what happened

**Status:** proposed (2026-10-13), built (2026-10-13)

Designed against `origin/main` at 2fdff3d8, release 0.9.1.

## Context

The runtime is event sourced. The ledger records every fact with its context, its correlation id, the run at the top of its chain, and its causation id, so what happened is already recorded, and a playbook's history shows it. What was missing is how it happened: nothing measured an HTTP request, a call of a model or of a tool, a round trip to the database or a workflow's input, an inbound `traceparent` was ignored, and the `trace_id` and `span_id` every event carries in its metadata were random values, minted by the event store's tracer that records nothing, so they matched no trace.

An operator running the runtime beside other services expects it to speak OpenTelemetry: traces, metrics and logs over OTLP to the collector they already run, with nothing sent anywhere unless they say so.

## Decision

### 1. The OpenTelemetry SDK lives in the server alone

`packages/server/src/telemetry/` holds every provider, exporter and instrumentation. The other packages emit through Effect's own tracing, `Effect.withSpan`, `Effect.annotateCurrentSpan`, links and `Metric`, and take no OpenTelemetry dependency; `@effect/opentelemetry` turns those spans, logs and metrics into OpenTelemetry's at the runtime's layer. Where a library runs outside an Effect fiber, the server hands it a plain value: the Hono middleware to `@on.auto/api`, the AI SDK's integration to `@on.auto/reasoning`, a function that writes the current trace into an MCP call's `_meta` to `@on.auto/mcp`, an observer of appends to `@on.auto/ledger`, and a middleware of the S3 client's stack for object storage. Library tests read their spans from a tracer that records them, `recordingTracer` in `@on.auto/operations/testing`.

### 2. No module-load hooks

Only instrumentation that works by registration is used: `@hono/otel` as middleware, undici through `diagnostics_channel`, which is Node's global `fetch`, Emmett's `EmmettInstrumentation`, which sets the store's default observability, the AI SDK's per-call integration, and the runtime-node instrumentation. The pg, aws-sdk and http instrumentations need hooks loaded before their modules, so they are left out; the event store's spans cover its reads and appends, and the S3 commands get spans from a middleware. Telemetry therefore starts inside `startServer`, after the settings are read, with no `--import`, and the image's command and the npm launcher are unchanged.

### 3. Off unless an endpoint is set

`OTEL_EXPORTER_OTLP_ENDPOINT`, or a signal's own endpoint, turns telemetry on; `OTEL_SDK_DISABLED=true` always turns it off. Off, no provider is registered, no middleware is mounted, Effect's own tracer runs unexported, nothing goes over the network and no line is logged at start.

### 4. OTLP over HTTP alone

`http/protobuf` unless set, `http/json` allowed, and `grpc` refused at start with the usual line naming the setting, which keeps gRPC out of the image. The URLs and headers are read from the injected environment, as every setting is, and passed to the exporters, so a server started in a test with an environment record exports where that record says.

### 5. No content unless asked

No prompt, model answer, tool arguments or result, event data or header is recorded. `TELEMETRY_CONTENT=true` records what was sent to models and answered, through the AI SDK's `recordInputs` and `recordOutputs`, and the data of each event on its log record, as `auto.on.data`, cut to 2,048 characters. Query values in outbound URLs are replaced by `REDACTED`, OTLP headers stay `Redacted` and are never logged, and S3 spans name the bucket and never a key.

### 6. The shape of a trace

- A request is a trace, and its response carries `x-trace-id`. An inbound `traceparent` continues the caller's trace; an MCP tool call with `traceparent` in `_meta` links to it.
- Each dispatched operation is a span named for the operation, inside the error boundary, so a rejection ends it well with `auto.on.outcome=rejected` and `error.type`, and a defect ends it in error.
- The ledger's appends and reads are Emmett's spans beneath it, with the run's lineage as their correlation and causation ids, and the `trace_id` and `span_id` an event stores are its append's.
- A model call is the AI SDK's `invoke_agent`, `step` and `chat` spans, and a tool call `execute_tool` with the HTTP request to the MCP server beneath it; that server is handed the trace in `_meta.traceparent`. A call made once, for an interaction function or a test of a tool, is a `tools/call <tool>` client span.
- The workflow host runs its fibers in the server's context. Each input it submits is a span named for its kind; a call is `call <function>` beneath the input that made it, with the run of the function and the input that answers the call beneath it, and the settlement beneath that input. A record it follows for a trigger or a listener is `follow <type>`, linked to the append that kept it, and a trigger's start that waited for a later minute keeps that link as `deferred_start`. Idle sweeps make no span, so the volume follows the work.
- A run is never one long trace: a timer, a later event or a deferred start begins a trace of its own, and `auto.on.run_id` on the host's spans and the appends finds a run's spans across them.

### 7. Every event appended is also a log record

The ledger's stores take an `AppendObserver`, told after each committed append, never on a conflict. The server's observer emits one log record per event from the logger `@on.auto/ledger`, named for the event's type, with the type as its body and as `auto.on.type`, since Loki drops a record's name and shows a record without a body as an empty line, and with its stream, position, message id, lineage, run, definition, depth and trigger; it counts `auto.on.runs.ended` by definition type and outcome. The export is batched and lossy by design; the ledger stays the record.

### 8. Names

Custom attributes are under `auto.on.*`, as the MCP `_meta` keys are under `auto.on/`. Semantic-convention names are used where one exists: `http.*`, `url.*`, `gen_ai.*`, `mcp.*`, `rpc.*`, `aws.s3.*`, `messaging.*`, `error.type`. The resource is `service.name` `auto-runtime` unless set, `service.version` the release, and `service.instance.id` a UUID for each process.

### 9. Versions follow the event store's line

Emmett 0.43.0-beta.50 and almanac 0.1.0-beta.47 declare `@opentelemetry/instrumentation` `>=0.220.0 <0.221.0` as an optional peer, so the server pins the 0.220.0 and 2.9.0 line exactly: one copy of each package, and `EmmettInstrumentation` extending the `InstrumentationBase` that `registerInstrumentations` drives. `instrumentation-undici` 0.30.0 and `instrumentation-runtime-node` 0.33.0 are the last on that line, `@effect/opentelemetry` 4.0.0 matches Effect 4.0.0, and `@ai-sdk/otel` 1.0.124 pins `ai` 7.0.124 exactly, so the two move together. The whole line moves when Emmett moves its range.

## Consequences

- An operator sets one variable and gets traces, metrics and logs; the guide is `docs/self-host/telemetry.md`.
- The image installs with `--no-optional`. `@event-driven-io/emmett/otel` imports almanac's OpenTelemetry module, which imports `@opentelemetry/instrumentation`, `api-logs`, `api` and `sdk-trace-base`, all optional for almanac; they are regular dependencies of the server at the same versions, which pnpm's hoisting lets almanac reach. Verified in the built image: the event store's spans arrive.
- The image grows by 13.9 MB: measured on arm64 with `docker image inspect`, 491.5 MB at 0.9.1 and 505.4 MB with telemetry, and 529.2 MB built with `AZURE_IDENTITY=true`.
- As it stops, the server waits at most a second for the providers to flush, then releases the global providers whatever is left; a collector that cannot be reached leaves the exporters' retries running, so the process exits through its exit deadline, still with `0`, about two seconds after `SIGTERM`.
- Outbound requests carry `traceparent` to model providers, gateways and MCP servers; the ids are random and carry nothing else.
- An inbound `traceparent` with the sampled flag is sampled under the default sampler; `OTEL_TRACES_SAMPLER=traceidratio` decides by ratio whatever the caller sends.
- The workflow host's own SQL is not spanned; a follow-up adds it if it is ever needed.

## Verification

- Each package's spans are tested with the recording tracer; the server's with a receiver of OTLP over HTTP and JSON, in process.
- A reasoning function that calls a tool is one trace from the request to the MCP server, which receives the trace in `_meta`; each event of the run stores that trace, and its log record carries it; nothing sent or answered is recorded unless `TELEMETRY_CONTENT` asks for it.
- A workflow that calls a function is one trace from the request through the input, the call, the run of the function, the answer and the settlement; the follower's span links to the append it delivered.
- The image was run beside `grafana/otel-lgtm`, and the traces, the event records and the metrics were read in Tempo, Loki and Prometheus.
- With telemetry off, the workflow host keeps its pace: three runs each, on one machine, of the long-run loop of 3,000 inputs answered 237 to 241 inputs a second at 2fdff3d8 and 235 to 238 with these changes, and 100 runs of 100 inputs side by side 292 to 295 and 289 to 295, which is within the noise of the measurement.
