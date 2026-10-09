# Brain terminology

This is the shared vocabulary for Auto's brain offering, its documentation and the code. It names the supported concepts and the capabilities being developed; [Functions and availability](functions.md#availability) records what the runtime currently implements.

The brain is the system. Workflows coordinate the work. Functions perform it. Assets support it. Runs record each time it is done.

## Capabilities and resources

A brain reasons, interacts, predicts, recalls, and computes. Workflows coordinate those functions around the way your business works.

There are six capabilities: coordination, reasoning, interaction, prediction, recall and computation. Coordination is expressed through workflows. The other five capabilities have function types, grouped in this order:

| Capability   | Resource someone defines | Category                |
| ------------ | ------------------------ | ----------------------- |
| Coordination | Workflow                 | Workflows               |
| Reasoning    | Reasoning function       | Functions → Reasoning   |
| Interaction  | Interaction function     | Functions → Interaction |
| Prediction   | Prediction function      | Functions → Prediction  |
| Recall       | Recall function          | Functions → Recall      |
| Computation  | Computation function     | Functions → Computation |

Use **brain functions** for the five function types. A function type in this table does not mean the runtime implements it.

Use these descriptions when choosing a function type:

| Category    | Description                                                                     |
| ----------- | ------------------------------------------------------------------------------- |
| Reasoning   | Use a prompt, skills, and tools to interpret information or produce a response. |
| Interaction | Exchange information with people or systems.                                    |
| Prediction  | Create and use an ML model to make predictions.                                 |
| Recall      | Answer from what the brain keeps of its own history.                            |
| Computation | Run defined code or expressions to calculate or transform data.                 |

These describe each type's intended responsibility. Self-hosted reasoning functions can use operator-configured MCP tools in a bounded loop. Auto Cloud tool access, skill references and a separately managed tool library are still planned. A reasoning function can interpret, generate, classify or judge; it is not restricted to a model's reasoning mode. Interaction covers people and machines. Prediction includes creating and using a predictive model. Recall answers from the brain's own history; recall over documents and other sources is not available yet. Computation executes specified logic and need not be mathematically pure.

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
| Run      | A workflow or function carried out once against particular inputs.                                                                         |
| Step run | One workflow step carried out once.                                                                                                        |
| Attempt  | One try at a step's work, or at a run started again under its id; a retry is another attempt.                                              |
| Result   | The output produced by a run.                                                                                                              |

A method does not require a `Method` resource. A shared function remains one definition when several workflows use it. A step refers to that definition; it does not copy it. A retry does not create another business function.

Definitions, versions, runs and results are separate concepts. The runtime versions definitions and records the version each run uses. It does not currently let a caller select an arbitrary historical definition version to run. A workflow can call the functions of its brain and other workflows; a workflow called this way is a subworkflow. A run of a workflow finishes later, so the call waits for it, and a run can be cancelled, which ends it as cancelled.

The configured trigger types are **Schedule trigger** and **Event trigger**; a workflow's schedule may name an event trigger and schedule triggers of both kinds, a cron schedule and an every schedule, each kept and matched on its own. Starting a workflow by hand is a **Run** action. Sending an approval or other input to a waiting run answers that run; it does not start a new one. Existing workflow timers and event waits are control steps, not configured triggers.

See [Workflows and runs](workflows.md) for the implemented version, retry, waiting and event behavior.

## Interaction

| Term         | Meaning                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Request      | What a run of an interaction function asks: a message, the party it goes to and when it expires.                                               |
| Inbox        | The brain's own place for requests, where a caller who may write to the brain reads and answers them.                                          |
| Delivery     | How a request reaches a party outside the brain: one call of a tool of a tool server the brain may use, which the function names in `deliver`. |
| Answer       | What the party gives back; it must match the function's answer schema and becomes the run's output.                                            |
| Notification | A request that takes no answer; its run succeeds once it is delivered.                                                                         |

An interaction function asks a person or a system and takes the answer later. One run makes one request; the answer settles that run, and a request nobody answers before it expires ends it as unanswered. Answering a request is not sending an event: an event goes to a waiting workflow run, and an answer goes to the run of the interaction function that asked.

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
| Schedule         | Timing configuration for a schedule trigger, in UTC.                                                     |
| Projection       | A defined derivation of a view or state from event history.                                              |
| Memory           | The broader ability to retain information and make it available.                                         |
| Event ledger     | One source of recorded history.                                                                          |

A reasoning function has a prompt; the prompt is not the entire configured function. A function exposed as a tool keeps its function type and identity. A skill supplies guidance rather than naming every executable component. Recall answers from what the brain keeps; memory, projections and the event ledger retain their distinct meanings.

The prediction function, its predictive model and the prediction in a run result are also distinct. Labels such as **Build model**, **Evaluate model**, **Predict**, **Retrain model**, **No model**, **Building model** and **Ready** apply only when those lifecycle controls exist. Prediction is not implemented yet.

Dream is an optional planned process using functions and history. It is not a sixth function type.
