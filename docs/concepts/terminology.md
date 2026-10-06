# Brain terminology

This is the shared vocabulary for Auto's brain offering, its domain code and its documentation. It names the supported concepts and the capabilities being developed; [Functions and availability](functions.md#availability) records what the runtime currently implements.

The brain is the system. Workflows coordinate the work. Functions perform it. Assets support it. Runs are its executions.

## Capabilities and resources

A brain reasons, interacts, predicts, recalls, and computes. Workflows coordinate those functions around the way your business works.

There are six capabilities: coordination, reasoning, interaction, prediction, recall and computation. Coordination is expressed through workflows. The other five capabilities have function types, grouped in this order:

| Capability   | Resource someone defines | Category                | Canonical domain name           |
| ------------ | ------------------------ | ----------------------- | ------------------------------- |
| Coordination | Workflow                 | Workflows               | `WorkflowDefinition`            |
| Reasoning    | Reasoning function       | Functions → Reasoning   | `ReasoningFunctionDefinition`   |
| Interaction  | Interaction function     | Functions → Interaction | `InteractionFunctionDefinition` |
| Prediction   | Prediction function      | Functions → Prediction  | `PredictionFunctionDefinition`  |
| Recall       | Recall function          | Functions → Recall      | `RecallFunctionDefinition`      |
| Computation  | Computation function     | Functions → Computation | `ComputationFunctionDefinition` |

Use **brain functions** for the five function types and **Functions** within a brain's Studio context. The domain names for planned types apply when those implementations exist; a type name in this table does not mean the runtime implements it.

Use these descriptions when choosing a function type:

| Category    | Description                                                                     |
| ----------- | ------------------------------------------------------------------------------- |
| Reasoning   | Use a prompt, skills, and tools to interpret information or produce a response. |
| Interaction | Exchange information with people or systems.                                    |
| Prediction  | Create and use an ML model to make predictions.                                 |
| Recall      | Retrieve or reconstruct relevant information from configured sources.           |
| Computation | Run defined code or expressions to calculate or transform data.                 |

These describe each type's intended responsibility. Self-hosted reasoning functions can use operator-configured MCP tools in a bounded loop. Auto Cloud tool access, skill references and a separately managed tool library are still planned. A reasoning function can interpret, generate, classify or judge; it is not restricted to a model's reasoning mode. Interaction covers people and machines. Prediction includes creating and using a predictive model. Recall can consult sources beyond event history. Computation executes specified logic and need not be mathematically pure.

Classify a function by its responsibility. Calling an API does not turn a recall function into an interaction function. Running code does not turn a prediction function into a computation function.

## Definitions and runs

| Term     | Meaning                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Brain    | The complete system for a business responsibility, including methods, functions, workflows, relevant information and operating boundaries. |
| Method   | The business's approach: what evidence matters, how decisions are made and what should happen.                                             |
| Workflow | A reusable definition coordinating steps, dependencies, conditions and handoffs.                                                           |
| Function | A reusable definition of an operation with declared inputs, outputs and behavior.                                                          |
| Step     | One use of a function, another workflow or a control operation within a workflow.                                                          |
| Trigger  | A configured condition that starts a workflow.                                                                                             |
| Version  | An identified revision of a definition or predictive model.                                                                                |
| Run      | One execution of a workflow or function against particular inputs.                                                                         |
| Step run | Execution of one workflow step.                                                                                                            |
| Attempt  | One attempt under the existing retry model.                                                                                                |
| Result   | The output produced by a run.                                                                                                              |

A method does not require a `Method` resource. A shared function remains one definition when several workflows use it. A step refers to that definition; it does not copy it. A retry does not create another business function.

Definitions, versions, runs and results are separate concepts. The runtime versions definitions and records the version each run uses. It does not currently let a caller select an arbitrary historical definition version to run. Workflow steps can call reasoning functions in the same brain; calling another workflow, or a subworkflow, is not supported yet.

The configured trigger types are **Schedule trigger** and **Event trigger**. Both are planned. Manual execution is a **Run** action. Sending an approval or other input to a waiting run answers that run; it does not start a new one. Existing workflow timers and event waits are control steps, not configured triggers.

See [Workflows and runs](workflows.md) for the implemented version, retry, waiting and event behavior.

## Supporting assets

| Term             | Meaning                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Prompt           | Instructions and input framing supplied to a language model by a reasoning function.                     |
| Skill            | A reusable package of task guidance and associated resources.                                            |
| Tool             | A calling interface for an operation, including an external operation or a function exposed to a caller. |
| Language model   | A model used by a reasoning function.                                                                    |
| Predictive model | A model created or used by a prediction function.                                                        |
| Source           | Information a function can consult.                                                                      |
| Event            | A recorded fact that something happened.                                                                 |
| Schedule         | Timing and timezone configuration for a schedule trigger.                                                |
| Projection       | A defined derivation of a view or state from event history.                                              |
| Memory           | The broader ability to retain information and make it available.                                         |
| Event ledger     | One source of recorded history.                                                                          |

A reasoning function has a prompt; the prompt is not the entire configured function. A function exposed as a tool keeps its function type and identity. A skill supplies guidance rather than naming every executable component. Recall retrieves or reconstructs information; memory, projections and the event ledger retain their distinct meanings.

The prediction function, its predictive model and the prediction in a run result are also distinct. Labels such as **Build model**, **Evaluate model**, **Predict**, **Retrain model**, **No model**, **Building model** and **Ready** apply only when those lifecycle controls exist. Prediction is not implemented yet.

Dream is an optional planned process using functions and history. It is not a sixth function type. Integrations, plugins, modules and GAS connectors retain their existing meanings.

## Studio wording

AUTO Studio is the operational interface; the agent is the primary interface for creating and using a brain. Within an existing brain context, group resources as follows when their management views exist:

- Build: Workflows, then Functions grouped under Reasoning, Interaction, Prediction, Recall and Computation.
- Library: Skills, Tools, Models and Sources.
- Operate: Runs and History.

Build, Library and Operate are navigation sections, not resources. Do not add empty management screens for planned capabilities. This runtime repository has no Studio application; its documentation navigation follows the learning path instead of reproducing the product sidebar.

Use **New workflow**, **New function** and **Add step** for the corresponding actions. After selecting a function type, use **New reasoning function**, for example. Counts use the resource phrase: **1 reasoning function**, **2 reasoning functions**, **No reasoning functions yet.** Dependency views use **Uses** and **Used by**.

Name example resources for their jobs, such as **Assess budget options**, **Request budget approval**, **Predict campaign signups**, **Retrieve previous budget decisions** and **Calculate remaining budget**. Keep user-authored names unchanged.

## Code and compatibility

Domain identifiers use the same nouns as the product. The canonical internal function kinds are `reason`, `interact`, `predict`, `recall` and `compute`. They describe function types; `workflow` is separate.

The shared runtime adapter supports workflows, functions and extension adapters. Its compatibility name is `Primitive`. The shared stored-record types are `Definition` and `Run`.

`BrainFunctionDefinition` covers the implemented function definitions, currently `ReasoningFunctionDefinition`. `WorkflowDefinition` identifies stored workflow definitions. `FunctionRun` and `WorkflowRun` distinguish their recorded runs. Type guards narrow decoded records using the existing `inference` and `orchestration` discriminators, preserving their fields and identities. They do not accept planned kinds or classify custom adapters as brain functions.

Parsing a source document produces `ReasoningFunctionDefinitionDocument` or `WorkflowDefinitionDocument`. These hold configuration rather than the stored name, version and audit fields. The workflow document remains a `JsonObject` checked by the existing DSL parser; the alias does not introduce a stronger schema. `makeReasoningFunctionAdapter` and `makeWorkflowAdapter` construct runtime adapters for these types, not individual saved definitions.

Keep these supported boundary names in requests and stored data:

| Boundary                                                                               | Canonical meaning                            |
| -------------------------------------------------------------------------------------- | -------------------------------------------- |
| `primitive: "inference"`                                                               | Reasoning function type                      |
| `primitive: "orchestration"`                                                           | Workflow type                                |
| `spec`, `specs`, `create_spec` and the other spec tools                                | Definition and definition operations         |
| `execution`, `execution_id`, `/executions` and execution tools                         | Run, run id and run operations               |
| `spec_version`                                                                         | The definition version referenced by the run |
| `spec_*`, `execution_*` and `workflow_input_applied` events                            | Existing definition and run history          |
| `@beonauto/inference`, `@beonauto/orchestration`, `@beonauto/specs` and `primitives/*` | Existing package and directory names         |

The internal kinds do not introduce new accepted API values. Planned function kinds are not valid substitutes for the runtime's supported `primitive` values. Package names, exported compatibility aliases, environment settings, deployment identities and historical records remain stable.

Keep **inference** for actual model execution or provider terms, **orchestration** for runtime coordination machinery, and **agent** for an actual actor, including external coding agents and tool-selecting behavior. Ordinary programming functions and cloud functions retain their names. Use **brain components** only as an umbrella phrase for workflows, functions and assets; it does not name a resource. **Faculties** is not part of the product taxonomy.

## Positioning

The proposed category for the brain-building offering is **business brain platforms**. The promise is **Make business expertise executable**. **Brain engineering** names the engineering discipline, **brain building** the services activity, and **Studio** the environment for visibility and management.

A business brain platform lets teams turn their methods into persistent AI systems, combining reasoning, interaction, prediction, recall and computation through coordinated workflows. People currently carry the method between tools: what to look for, which analysis to run, what happened before and what should happen next. The aim is to make that method something the business can define, run, inspect and improve.

This is positioning for the brain offering, not a claim that every planned capability exists or that Auto owns the category name. Product explanations and examples must keep implemented behavior, planned capabilities and customer evidence distinct.
