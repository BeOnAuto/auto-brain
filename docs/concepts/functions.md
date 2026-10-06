# Functions

A brain reasons, interacts, predicts, recalls and computes. Workflows coordinate those functions around the way your business works.

A brain function defines a reusable operation, including its inputs, outputs and behavior. A workflow coordinates uses of those functions. The same function can be called directly by an agent or used as a step in more than one workflow. Coordination and the five function types make six capabilities; workflows are separate from the function categories.

## Availability

The source-available runtime is in early development and is not ready for production use. This table distinguishes available behavior from the capabilities being developed.

| Group       | What someone defines    | Current runtime |
| ----------- | ----------------------- | --------------- |
| Reasoning   | A reasoning function    | Available       |
| Interaction | An interaction function | Planned         |
| Prediction  | A prediction function   | Planned         |
| Recall      | A recall function       | Planned         |
| Computation | A computation function  | Planned         |

Workflows are available and coordinate the functions above. They are not another function type.

Every runtime runs workflows itself, with nothing more to set up: a connection's tools include `send_execution_event`, and `create_spec` accepts the primitive `orchestration`.

Dream is coming soon. It is an optional process using history and functions, not a sixth function type. API details should match the runtime version in use.

## Reasoning

A reasoning function configures language-model work such as interpreting information, generating a response or evaluating options. Its prompt supplies instructions and input framing.

For example, a reasoning function can review a campaign brief against your team's criteria. Each run supplies a brief to the saved prompt, invokes the model and records the output and usage. The [first-brain tutorial](../tutorials/first-brain.md) builds that example.

An external agent can call a reasoning function through Auto's MCP interface. Tools called from inside the reasoning function are a separate capability, described below.

See [Reasoning function format](../reference/reasoning-format.md).

## Interaction

An interaction function defines input or output between the brain and people or other machines. Examples include requesting an approval, sending a notification, receiving structured input and exchanging information with a system.

Human approval is one interaction pattern; machine-to-machine input and output belong here too.

## Prediction

A prediction function defines an objective and the data needed to create and use a predictive model. Prediction includes building or training that model, evaluating it, and using a ready model to estimate an outcome.

Keep three objects distinct: the prediction function someone defines, the predictive model it creates or uses, and the prediction returned by a run. The proposed lifecycle allows an initial call to build a model and later calls to use it, with states such as no model, building and ready.

## Recall

A recall function retrieves or reconstructs relevant information. Its sources can include recorded events, documents or other connected information. A projection derives a view from event history and is one way recall can work.

Memory describes the broader retention and availability of information. Recall is the operation that obtains the relevant parts. The event ledger already stores events and run records; it is one possible source for recall.

## Computation

A computation function executes specified code or expressions with defined inputs and outputs, such as a calculation or data transformation. It need not be mathematically pure. AI-assisted authoring can help write the logic; once defined, the operation executes that specified logic.

## Supporting assets

Prompts, skills, tools, models and sources support functions. They are not additional function types.

A skill is reusable task guidance and associated resources. A tool is a calling interface: a function exposed as a tool retains its function type. Tools can also represent operations outside the brain. A language model and a predictive model serve different purposes, so qualify the word model when that distinction matters.

<span id="tool-access-inside-a-reason-function"></span>

## Tool access inside a reasoning function

Coming soon. The planned shared tool catalog will let a reasoning function use authorized business operations. The preferred connection is a single MCP tool gateway, with direct tool lists as another option. Apollo GraphOS Agent Services is one possible gateway for graph-based tools; Apollo is optional.

This needs outbound MCP connections, tool definitions and dispatch, and a bounded loop in which the model can request a tool, receive its result and continue. Those capabilities are not implemented in the current runtime. Provider settings called model gateways connect to language models; they do not provide an MCP tool gateway.

Today, the external agent can collect evidence through its own connections and pass it into a reasoning function. Connecting that agent to Auto does not give the function access to the agent's tools, credentials or accounts. See the [MCP reference](../reference/mcp.md) for the available inbound connection.

## API compatibility

Use product terminology when explaining the work, while keeping current wire identifiers intact:

| Product term       | Legacy API term      |
| ------------------ | -------------------- |
| Reasoning function | `inference` spec     |
| Workflow           | `orchestration` spec |
| Definition         | `spec`               |
| Run                | `execution`          |

For example, creating a reasoning function uses `create_spec` with `primitive: "inference"`, and creating a workflow uses `primitive: "orchestration"`. Renaming product categories does not rewrite event history or introduce new routes. Planned function types are not accepted API identifiers yet. [Workflow format](../reference/workflow-format.md) describes the workflow document.
