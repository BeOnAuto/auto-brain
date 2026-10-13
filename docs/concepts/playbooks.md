# Playbooks and methods

A playbook is a system built around a business responsibility, such as reviewing campaigns or evaluating budget changes. It brings together the team's methods, the functions and workflows that express them, relevant information and limits on what it may do.

A marketing specialist knows what makes a brief ready for review. Working with an agent, they can capture those criteria in a function and run it against each new brief. Engineers support the connections and operational requirements when needed.

## Business methods

A method is your approach to a piece of work: the evidence you consider, how you evaluate it and what should happen next. It may be documented, or it may be knowledge your specialists carry in their heads.

For a campaign review, the method might require a specific audience, a clear offer and a budget within an agreed limit. The function expresses those criteria as an operation the playbook can run. One method can involve several functions and workflows; it does not require a separate `Method` object or folder.

## Playbooks, brains, functions and workflows

Every playbook contains one **brain**, its reusable function collection, and its **workflows**. The brain is created with the playbook and shares its lifecycle. It is not a second business resource. Runs belong to the playbook and refer to the executed function or workflow. Connections are runtime-level authorized routes to services and may serve several playbooks.

```text
Auto Runtime
├── Playbooks
│   └── Paid media planning
│       ├── Brain
│       │   ├── Forecast signups (Prediction)
│       │   └── Compare performance (Computation)
│       └── Workflows
│           ├── Monthly plan
│           └── Check outcomes
└── Connections
```

Auto Runtime executes the work while it remains running and connected. Auto Studio presents and manages it. Your agent is a separate client.

| Term     | Meaning                                                        | Campaign-review example                      |
| -------- | -------------------------------------------------------------- | -------------------------------------------- |
| Playbook | The complete system for a business responsibility              | A marketing playbook                         |
| Method   | The business's approach to the work                            | The criteria used to review a campaign brief |
| Function | A reusable operation with defined inputs, outputs and behavior | Review a brief against those criteria        |
| Workflow | A definition coordinating steps and their dependencies         | Review the brief, then request approval      |
| Step     | A use of a function, another workflow or control operation     | Run the brief review                         |
| Run      | A definition carried out once against particular inputs        | Review of the autumn campaign brief          |
| Result   | The output produced by that run                                | A recommendation and missing information     |

The [function types](functions.md) describe different kinds of work. [Workflows](workflows.md) coordinate those functions. A workflow that another workflow calls is a subworkflow, and the workflow that calls it waits for its run.

## The agent and the playbook

Your agent helps create and refine definitions, supplies inputs and calls functions. It can coordinate its own calls to Auto and other systems.

The playbook retains the saved definitions and recorded runs independently of that conversation. Another authorized colleague can use the same function from their agent. A colleague's access to the playbook does not automatically grant access to someone else's connected accounts.

Auto Studio provides visibility into running work, history and operating controls. Authoring starts with the agent.

## Authority and judgment

Define which actions the playbook may take and where a person must decide. A review function can recommend a budget change without being authorized to make one. Where a person must decide, an interaction function asks them and the workflow waits for the answer: a caller who may write to the playbook answers it, or the person replies where the request reached them, when the function reads replies, and the run that asked takes the answer within the host's sweep, a second by default.

Those limits must apply to operations called directly as well as through a workflow. An approval step cannot protect an action that another caller is independently allowed to invoke. The runtime provides organization and playbook permissions through API keys; [HTTP permissions](../reference/http.md#requests-and-access) describes their scope.

[Build your first playbook](../tutorials/first-playbook.md) puts these concepts into practice with a saved campaign-review function.
