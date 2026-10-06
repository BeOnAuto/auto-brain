# Functions

A brain reasons, interacts, predicts, recalls and computes. Workflows coordinate those functions around the way your business works.

A brain function defines a reusable operation, including its inputs, outputs and behavior. A workflow coordinates uses of those functions. The same function can be called directly by an agent or used as a step in more than one workflow. Coordination and the five function types make six capabilities; workflows are separate from the function categories.

## Availability

The source-available runtime is in early development and is not ready for production use. This table distinguishes available behavior from the capabilities being developed.

| Group       | What someone defines    | Current runtime                    |
| ----------- | ----------------------- | ---------------------------------- |
| Reasoning   | A reasoning function    | Available                          |
| Interaction | An interaction function | Planned                            |
| Prediction  | A prediction function   | Planned                            |
| Recall      | A recall function       | Planned                            |
| Computation | A computation function  | Available in a self-hosted runtime |

Workflows are available and coordinate the functions above. They are not another function type.

Every runtime runs workflows itself, with nothing more to set up: a connection's tools include `send_execution_event`, and `create_spec` accepts the primitive `orchestration`. A self-hosted runtime runs computation functions too, and its `create_spec` accepts the primitive `computation`; Auto Cloud does not offer them yet.

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

In the current runtime, a computation function is a program in jq with schemas for its input and output. A run applies the program to its input and answers with exactly one output, the same output for the same input every time, within bounds on its work, memory and time. It reaches nothing outside the brain. Use it for the arithmetic a language model should not do: a workflow can read figures through a reasoning function's tools, compute totals, paces and projections exactly with a computation function, and have another reasoning function write about them.

See [Computation function format](../reference/computation-format.md).

## Supporting assets

Prompts, skills, tools, models and sources support functions. They are not additional function types.

A skill is reusable task guidance and associated resources. A tool is a calling interface: a function exposed as a tool retains its function type. Tools can also represent operations outside the brain. A language model and a predictive model serve different purposes, so qualify the word model when that distinction matters.

## Tool access inside a reasoning function

A reasoning function can call the tools of MCP servers that the runtime's operator configures. The operator binds each server to an org, and optionally to some of its brains, and can narrow which of its tools functions may name. A function lists the tools it may use, such as `graph/search`, or `graph/*` for every tool of a server that the operator allows. During a run, the model can request one of those tools, receive its result and continue before it answers, within bounds on the number of calls, the size of their results and the time the run takes. Each call appears in the run's history as it happens.

A tool may change something outside the brain. A run that called tools and did not succeed is therefore not run again under the same execution id; start a new run once you have checked what its history shows it called. When any MCP server is configured, an agent connected to Auto sees `execute_spec` marked as possibly destructive, so it can ask before running a function.

One of those servers can be an agent services gateway, which fronts the systems an organization connected and applies its own policies to the application whose key the runtime uses. Provider settings called model gateways connect to language models; they do not provide MCP tools.

Tool access is available in a self-hosted runtime whose operator configures MCP servers; Auto Cloud does not offer it yet. Skill references and a separately managed tool library are still planned. Connecting an external agent to Auto does not give the function access to that agent's tools, credentials or accounts: the agent can still collect evidence through its own connections and pass it in as input. See the [Reasoning function format](../reference/reasoning-format.md#tools) and, for the inbound connection, the [MCP reference](../reference/mcp.md).
