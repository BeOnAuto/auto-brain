# Core concepts and terminology

This is the shared vocabulary for Auto's playbook offering, its documentation and the code. It names the supported concepts and the capabilities being developed; [Functions and availability](functions.md#availability) records what the runtime currently implements.

Auto is the product; playbook automation is the category. Auto Runtime stores and executes playbooks. Auto Studio presents and manages them; the user’s agent is a separate client.

A playbook contains one brain and its workflows. The brain is its collection of reusable functions, created automatically with the playbook and sharing its lifecycle. Functions perform capabilities, including actions; workflows coordinate them. Runs belong to the playbook. Connections provide authorized service access and can serve several playbooks.

## Capabilities and resources

A playbook reasons, interacts, predicts, recalls, and computes. Workflows coordinate those functions around the way your business works.

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

| Category    | Description                                                                       |
| ----------- | --------------------------------------------------------------------------------- |
| Reasoning   | Use a prompt, skills, and tools to interpret information or produce a response.   |
| Interaction | Exchange information with people or systems.                                      |
| Prediction  | Predict a quantity from the playbook's own history with a model a trainer builds. |
| Recall      | Answer from what the playbook keeps of its own history.                           |
| Computation | Run defined code or expressions to calculate or transform data.                   |

These describe each type's intended responsibility. Self-hosted reasoning functions can use operator-configured MCP tools in a bounded loop. Auto Cloud tool access, skill references and a separately managed tool library are still planned. A reasoning function can interpret, generate, classify or judge; it is not restricted to a model's reasoning mode. Interaction covers people and machines. Prediction answers from a predictive model a trainer builds outside the playbook, which the playbook scores before a version of the function holds it. Recall answers from the playbook's own history; recall over documents and other sources is not available yet. Computation executes specified logic and need not be mathematically pure.

Classify a function by its responsibility. Calling an API does not turn a recall function into an interaction function. Running code does not turn a prediction function into a computation function.

## Definitions and runs

| Term         | Meaning                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Playbook     | The complete system for a business responsibility, including methods, functions, workflows, relevant information and operating boundaries.   |
| Brain        | The playbook's reusable function collection; it shares the playbook lifecycle.                                                               |
| Auto Runtime | The software that stores and executes playbooks.                                                                                             |
| Auto Studio  | The interface for inspecting and managing playbooks.                                                                                         |
| Connection   | Authorized service access, potentially shared by several playbooks.                                                                          |
| Method       | The business's approach: what evidence matters, how decisions are made and what should happen.                                               |
| Workflow     | A reusable definition coordinating steps, dependencies, conditions and handoffs.                                                             |
| Function     | A reusable definition of an operation with declared inputs, outputs and behavior.                                                            |
| Step         | One use of a function, another workflow or a control operation within a workflow.                                                            |
| Trigger      | A configured condition that starts a workflow.                                                                                               |
| Version      | An identified revision of a definition or predictive model.                                                                                  |
| Overview     | A definition in plain words for a person who does not read its document, which the runtime writes from the document when it saves a version. |
| Run          | A workflow or function carried out once against particular inputs.                                                                           |
| Step run     | One workflow step carried out once.                                                                                                          |
| Attempt      | One try at a step's work, or at a run started again under its id; a retry is another attempt.                                                |
| Result       | The output produced by a run.                                                                                                                |

A method does not require a `Method` resource. A shared function remains one definition when several workflows use it. A step refers to that definition; it does not copy it. A retry does not create another business function.

Definitions, versions, runs and results are separate concepts. The runtime versions definitions and records the version each run uses. It does not currently let a caller select an arbitrary historical definition version to run. A workflow can call the functions of its playbook and other workflows; a workflow called this way is a subworkflow. A run of a workflow finishes later, so the call waits for it, and a run can be cancelled, which ends it as cancelled. Each version of a definition has one overview, written from its document: it describes the definition and is never a second source of it.

The configured trigger types are **Schedule trigger** and **Event trigger**; a workflow's schedule may name an event trigger and schedule triggers of both kinds, a cron schedule and an every schedule, each kept and matched on its own. Starting a workflow by hand is a **Run** action. Sending an approval or other input to a waiting run answers that run; it does not start a new one. Existing workflow timers and event waits are control steps, not configured triggers.

See [Workflows and runs](workflows.md) for the implemented version, retry, waiting and event behavior.

## Interaction

| Term         | Meaning                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request      | What a run of a function waits on when it asks a person: a message, the party it goes to and when it expires.                                        |
| Inbox        | The playbook's own place for requests, where a caller who may write to the playbook reads and answers them.                                          |
| Delivery     | How a request reaches a party outside the playbook: one call of a tool of a tool server the playbook may use, which the function names in `deliver`. |
| Answer       | What the party or the tool gives back; it must match the request's answer schema, is recorded on the run once, and becomes the run's output.         |
| Notification | A request that takes no answer; its run succeeds once it is delivered.                                                                               |

An interaction function asks a system and answers at once, or asks a person and takes the answer later. A run that asks a person makes one request; the answer is recorded on that run, which takes it within the host's sweep, a second by default, and a request nobody answers before it expires ends it as unanswered. Answering a request is not sending an event: an event goes to a waiting workflow run, and an answer goes to the run of the function that asked.

## Prediction

| Term           | Meaning                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Dataset        | The rows a prediction function learns from, one for each series and period, folded from the playbook's events or uploaded. |
| Brief          | The text a trainer reads first, which the function's document renders over its dataset's figures.                          |
| Build          | A run of a prediction function that asks a trainer for candidate models, scores them and keeps the winner as a version.    |
| Trainer        | The person or agent who reads a build's brief and rows, fits models outside the playbook and uploads them.                 |
| Candidate      | A model file a trainer uploads to a build, scored on periods the trainer never saw.                                        |
| Card           | What a version was built from and how it scored, recorded when the build keeps it.                                         |
| Shadow         | A later version predicting beside the active version as periods close, before it may replace it.                           |
| Active version | The version of a prediction function that answers its questions.                                                           |

A prediction function, the predictive model a version of it holds and the prediction a run returns are distinct. Each version a build keeps holds one model with its card, and a function's versions are numbered from 1, apart from the versions of its document. The active version alone answers questions; a version built while another is active runs in shadow for the periods its function names before its rule may activate it, and a version activated again by hand is a rollback.

## Callers

| Term             | Meaning                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Caller           | Whoever a request acts for, a key, the local developer or a signed-in person, named on every fact it records.                            |
| Key              | A credential the runtime issues itself, for a machine, a pipeline, a trainer's agent or a grant narrower than a signed-in person's.      |
| Local developer  | The caller of every request in local mode, on the developer's own machine, with every permission in every org.                           |
| Signed-in person | A person the Auto identity service signs in, with every permission in the org of their organization there, recorded under their subject. |

A signed-in person is the person a request comes from; a person an interaction function asks is the party of its request, who may answer without calling the runtime at all. A run keeps acting as the caller that started it.

## Supporting assets

| Term             | Meaning                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Prompt           | Instructions and input framing supplied to a language model by a reasoning function.                                  |
| Skill            | A reusable package of task guidance and associated resources.                                                         |
| Tool             | A calling interface for an operation, including an external operation or a function exposed to a caller.              |
| Language model   | A model used by a reasoning function.                                                                                 |
| Predictive model | A model a trainer builds for a prediction function, as a file the playbook runs in a process of its own.              |
| Source           | Information a function can consult.                                                                                   |
| Event            | A recorded fact that something happened, its type named in the past tense for what happened, as `delivery_failed` is. |
| Event data       | The fact itself: what happened, and nothing of who acted, when, or the run it belongs to.                             |
| Event metadata   | Where an event is recorded, when it happened, who acted, and the definition, run and chain it belongs to.             |
| Schedule         | Timing configuration for a schedule trigger, in UTC.                                                                  |
| Projection       | A defined derivation of a view or state from event history.                                                           |
| Memory           | The broader ability to retain information and make it available.                                                      |
| Event ledger     | One source of recorded history.                                                                                       |

A reasoning function has a prompt; the prompt is not the entire configured function. A function exposed as a tool keeps its function type and identity. A skill supplies guidance rather than naming every executable component. Recall answers from what the playbook keeps; memory, projections and the event ledger retain their distinct meanings.

Dream is an optional planned process using functions and history. It is not a sixth function type.
