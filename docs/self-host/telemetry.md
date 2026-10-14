# Send telemetry to an OpenTelemetry collector

The ledger records what happened in a playbook. With telemetry on, the server also exports how it happened, over OTLP to any OpenTelemetry collector or backend: a trace of every request, run and outbound call, metrics of the server, its models, its tools and its runs, and logs, including one record for each event the ledger keeps.

Telemetry is off until you name where it goes, and until then the server sends nothing anywhere.

## Turn it on

Point the server at your collector's OTLP/HTTP receiver:

```bash
echo 'OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.internal:4318' >> auto-runtime.env
```

At start the server logs `Telemetry is on, exported over OTLP`, naming the service, where traces, metrics and logs go, as an origin and a protocol, and whether content is recorded; it never logs the headers. A setting it cannot read stops it at start, naming the setting and what it expects.

## Settings

| Variable                                                                                                        | Default                 | Purpose                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                                   | none                    | The base URL of the collector, `http` or `https`; the server sends traces to `/v1/traces`, metrics to `/v1/metrics` and logs to `/v1/logs` under it                                            |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | none                    | The URL of one kind of signal, used as given; a kind with neither this nor the base URL is not exported, and with no kind exported telemetry is off                                            |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, and the same for each kind, such as `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`         | `http/protobuf`         | `http/protobuf` or `http/json`; the server exports over HTTP alone, so `grpc` stops it at start                                                                                                |
| `OTEL_EXPORTER_OTLP_HEADERS`, and the same for each kind                                                        | none                    | Headers sent with every export, as `name=value` pairs separated by commas, such as a backend's API key; the server never logs them                                                             |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`                                           | `otlp`                  | `none` leaves that kind out                                                                                                                                                                    |
| `OTEL_SERVICE_NAME`                                                                                             | `auto-runtime`          | The `service.name` of everything the server exports                                                                                                                                            |
| `OTEL_RESOURCE_ATTRIBUTES`                                                                                      | none                    | Attributes added to everything the server exports, as `name=value` pairs separated by commas, such as `deployment.environment.name=production`                                                 |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`                                                                | `parentbased_always_on` | Which traces are kept: `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off` or `parentbased_traceidratio`; the argument is the ratio kept, from 0 to 1 |
| `OTEL_METRIC_EXPORT_INTERVAL`                                                                                   | `60000`                 | Milliseconds between exports of metrics, from 1,000 to 3,600,000                                                                                                                               |
| `OTEL_SDK_DISABLED`                                                                                             | `false`                 | `true` turns telemetry off whatever else is set                                                                                                                                                |
| `TELEMETRY_CONTENT`                                                                                             | `false`                 | `true` records content: what was sent to models and what they answered, and the data of each event on its log record, cut to 2,048 characters; see [What is recorded](#what-is-recorded)       |

The settings are read from the environment only. As it stops, the server waits at most a second for what it has left to send, so a collector that cannot be reached does not hold up a restart. The exporters also read `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_COMPRESSION`, `OTEL_EXPORTER_OTLP_CERTIFICATE`, `OTEL_EXPORTER_OTLP_CLIENT_KEY` and `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`, and the same for each kind, from the server's environment. Each server process names itself with a `service.instance.id` of its own, so several servers sharing a database are told apart.

## Traces

A request is a trace. Its span is named for the method and the route, such as `POST /v1/orgs/:org/playbooks/:playbook/definitions/:type/:name/run`, and its response carries the trace's id in the `x-trace-id` header. A request with a W3C `traceparent` header continues the caller's trace. A tool an agent calls over MCP is a `tools/call <tool>` span beneath the request that carried the call, linked to the agent's trace when the call carries `traceparent` in its `_meta`. `GET /health` is not traced.

Beneath the request:

| Span                                                  | What it is                                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The operation, such as `run_definition` or `get_run`  | The work the request asked for, with `auto.on.org`, `auto.on.playbook`, `auto.on.caller` and `auto.on.outcome`; a rejection adds `error.type` and the kind and because of the rejection      |
| `eventStore.appendToStream`, `eventStore.readStream`  | The ledger's appends and reads; an append names the run in `auto.on.run_id` and its chain in `messaging.message.correlation_id` and `messaging.message.causation_id`                         |
| `invoke_agent <model>`, `step <n>`, `chat <model>`    | A reasoning function's call of its model, each round of it, and each request to the provider, with the provider, the model, the tokens and why it finished                                   |
| `execute_tool <tool>`                                 | A tool the model called, with the HTTP request to its tool server beneath it where that server is reached over HTTP                                                                          |
| `tools/call <tool>`                                   | A tool of an MCP server the server called once, for an interaction function or for `execute`, naming the tool server and how the call ended                                                  |
| `POST`, `GET` and the other methods                   | Each HTTP request the server sends, to a model provider, a gateway or a tool server, with every value of its query replaced by `REDACTED`                                                    |
| `S3.GetObject`, `S3.PutObject` and the other commands | Each request to the bucket of the [object store](object-storage.md), naming the bucket and never a key                                                                                       |
| `program <kind>`, `model <kind>`                      | A job of the server's workers, such as a computation, a recall function's answer, a fold of views or a check of a definition, or of a prediction function's model process, with how it ended |

A workflow adds its own spans. Each input its run takes is a span named for its kind, `started`, `timer_fired`, `call_answered`, `event_received`, `event_offered` or `cancel_requested`, with `auto.on.run_id`. A call the workflow makes is `call <function>` beneath the input that made it, with the run of the function and the input that answers the call beneath it, and the `settle` that records the end of the workflow's run beneath that input. So a workflow started by a request is one trace, from the request to the end of everything it calls without waiting.

A run is never one long trace. An input that comes later, such as a timer that fires, an event a run listened for or a call answered after a wait, begins a trace of its own; every span of the workflow names its run in `auto.on.run_id`, so a search on it finds a run's spans across its traces. A record that starts a workflow through a trigger or reaches a listener is a `follow <type>` span linked to the trace of the request that recorded it, and a start that waited for a later minute is a `deferred_start` span with the same link.

The events the playbook keeps record the trace and the span of the append that recorded them, `trace_id` and `span_id` in their [metadata](../reference/http.md#run-history-and-playbook-events), so a row of a run's history leads to its trace. A trace that was not sampled has real ids that your backend never received.

## Metrics

| Metric                                                                                                                            | What it measures                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `http.server.request.duration`, `http.server.active_requests`                                                                     | The requests the server answers, by method, route and status                                                              |
| `http.client.request.duration`                                                                                                    | The HTTP requests the server sends                                                                                        |
| `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`                                                                   | Each call of a model, by provider and model, with the kind of failure of a call that failed; the tokens sent and answered |
| `mcp.client.operation.duration`                                                                                                   | Each tool of an MCP server called once, by tool and tool server, with how a call that failed ended                        |
| `auto.on.runs.ended`                                                                                                              | The runs that ended, by the type of their definition and by outcome, `succeeded`, `rejected` or `failed`                  |
| `auto.on.pool.job.duration`                                                                                                       | The jobs of the server's workers, by kind and by how each ended                                                           |
| `emmett.event.appending.count`, `emmett.stream.appending.duration`, `emmett.stream.reading.duration` and the event store's others | The ledger's appends and reads                                                                                            |
| `nodejs.eventloop.delay.*`, `nodejs.eventloop.utilization`, `v8js.gc.duration`, `v8js.memory.heap.*`                              | The Node.js process: its event loop, its garbage collection and its heap                                                  |

## Logs

Every line the server logs is also a log record over OTLP, with the trace and the span it was logged in, where it was logged in one. Every event the ledger appends is a log record too, from the logger `@on.auto/ledger`, named for the event's type, such as `run_started` or `tool_call_answered`, whose line is that type, with the trace of its append and these attributes, each where the event has it:

| Attribute                                                                          | Contents                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `auto.on.type`                                                                     | The event's type, also kept as an attribute for backends that do not keep a record's name  |
| `auto.on.stream`, `auto.on.position`, `auto.on.message_id`                         | Where the event is kept and its id, as its `metadata` shows them                           |
| `auto.on.by`, `auto.on.run_id`                                                     | Who acted, and the run the event belongs to                                                |
| `auto.on.definition.type`, `auto.on.definition.name`, `auto.on.definition.version` | The definition of the run                                                                  |
| `auto.on.depth`, `auto.on.call_depth`, `auto.on.trigger.kind`                      | How the run was started: reactions above it, calls above it, and the kind of its trigger   |
| `auto.on.correlation_id`, `auto.on.causation_id`                                   | The run at the top of the event's chain, and the event that led to it                      |
| `auto.on.data_bytes`                                                               | The size of the event's data as JSON                                                       |
| `auto.on.data`                                                                     | The event's data as JSON, cut to 2,048 characters, only when `TELEMETRY_CONTENT` is `true` |

In Loki, for example, `{service_name="auto-runtime"} | auto_on_type="run_failed"` lists the runs that failed, each with the trace it failed in. The records are sent in batches and may be lost when the collector is down; the ledger stays the record.

## What is recorded

Unless `TELEMETRY_CONTENT` is `true`, nothing a playbook holds leaves the server in telemetry: no prompt, instructions or model answer, no arguments or result of a tool, and no data of an event. Headers are never recorded, the query values of every URL the server calls are replaced by `REDACTED`, and object storage is named by its bucket alone. With `TELEMETRY_CONTENT=true`, the spans of model calls carry what was sent and answered, and each event's log record carries its data in `auto.on.data`, cut to 2,048 characters; turn it on only for a collector whose readers may read the playbooks.

The server hands the trace to what it calls: a `traceparent` header on its HTTP requests to model providers, gateways and tool servers, and `traceparent` in the `_meta` of every call of a tool of an MCP server. The ids are random and carry nothing else. Under the default sampler, a caller that sends a sampled `traceparent` decides that the trace is kept; set `OTEL_TRACES_SAMPLER=traceidratio` to keep a share of traces whatever callers send.

## Try it with Grafana

The [`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) image runs a collector with Tempo, Loki, Prometheus and Grafana in one container, enough to look at the telemetry of a server on your machine:

```bash
docker network create auto-telemetry
docker run --detach --name lgtm --network auto-telemetry --publish 3000:3000 grafana/otel-lgtm
docker run --detach --name auto-runtime --network auto-telemetry --publish 5555:5555 \
  --env-file auto-runtime.env \
  --env OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318 \
  --volume auto-runtime-data:/data onauto/runtime
```

Open Grafana at `http://localhost:3000`, then **Explore**: Tempo holds the traces, Loki the logs, with the ledger's events under the service `auto-runtime`, and Prometheus the metrics, with dots in their names turned into underscores, such as `http_server_request_duration_seconds`.
