# Playbooks

A playbook is how a team carries out one business responsibility, such as reviewing campaigns or evaluating budget changes. It holds the functions and workflows that express the team's methods, relevant information and limits on what they may do. Auto Runtime runs those functions and workflows and records every run.

A marketing specialist knows what makes a brief ready for review. Working with an agent, they can capture those criteria in a function and run it against each new brief. Engineers support the connections and operational requirements when needed.

## Business methods

A method is your approach to a piece of work: the evidence you consider, how you evaluate it and what should happen next. It may be documented, or it may be knowledge your specialists carry in their heads.

For a campaign review, the method might require a specific audience, a clear offer and a budget within an agreed limit. The function expresses those criteria as an operation Auto Runtime can run. One method can involve several functions and workflows; it does not require a separate `Method` object or folder.

## Playbooks, functions and workflows

| Term     | Meaning                                                        | Campaign-review example                      |
| -------- | -------------------------------------------------------------- | -------------------------------------------- |
| Playbook | How a team carries out one business responsibility             | A marketing playbook                         |
| Method   | The business's approach to the work                            | The criteria used to review a campaign brief |
| Function | A reusable operation with defined inputs, outputs and behavior | Review a brief against those criteria        |
| Workflow | A definition coordinating steps and their dependencies         | Review the brief, then request approval      |
| Step     | A use of a function, another workflow or control operation     | Run the brief review                         |
| Run      | A definition carried out once against particular inputs        | Review of the autumn campaign brief          |
| Result   | The output produced by that run                                | A recommendation and missing information     |

The [function types](functions.md) describe different kinds of work. [Workflows](workflows.md) coordinate those functions. A workflow that another workflow calls is a subworkflow, and the workflow that calls it waits for its run.

## Your agent and Auto Runtime

Your agent helps create and refine definitions, supplies inputs and calls functions. It can coordinate its own calls to Auto and other systems.

Auto Runtime keeps the playbook's saved definitions and recorded runs independently of that conversation. Another authorized colleague can use the same function from their agent. A colleague's access to the playbook does not automatically grant access to someone else's connected accounts.

Auto Studio provides visibility into running work, history and operating controls. Authoring starts with the agent.

## Authority and judgment

Define which actions the playbook may take and where a person must decide. A review function can recommend a budget change without being authorized to make one. Where a person must decide, an interaction function asks them and the workflow waits for the answer: a caller who may write to the playbook answers it, or the person replies where the request reached them, when the function reads replies.

Those limits must apply to operations called directly as well as through a workflow. An approval step cannot protect an action that another caller is independently allowed to invoke. The runtime provides organization and playbook permissions through API keys; [HTTP permissions](../reference/http.md#requests-and-access) describes their scope.

[Build your first playbook](../tutorials/first-playbook.md) puts these concepts into practice with a saved campaign-review function.
