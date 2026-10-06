# History and Dream

A brain's history records saved definitions and what happened when they ran. After a campaign review, you can return to the definition version used, the rendered prompt and the result it produced. The current runtime stores run inputs in an event ledger; the run API exposes the recorded prompt and result, not the original input object.

For reasoning functions, recorded details also include model usage and the rendered prompt, subject to record-size limits. A new run does not automatically receive every earlier result as context; the required information must be supplied to the function.

Recorded history needs persistent storage and tested backups. Teams operating their own runtime should include both in their [self-hosting plan](../self-host.md). Event history can only preserve information recorded in it; external systems and unrecorded conversations are not retained automatically.

## Recall and projections

Recall retrieves or reconstructs relevant information. A projection derives a view or state from recorded events. The ledger is one possible source for a recall function, alongside other connected information.

Standalone recall definitions are planned. Today you can read a brain's recorded history in three ways, over HTTP and MCP:

- `list_executions` lists the runs of a brain, newest first, and can keep only the runs of one function or in one status.
- `get_execution_history` reads the history of one run: the facts recorded about it, from each start to how it ended, each with when it happened and a plain-language summary.
- `list_brain_events` follows everything recorded in a brain, such as definitions created, updated and retired and runs started and ended, and can keep one type of event, what was recorded since a time, or everything one run and the runs it started recorded.

These reads page through long histories and keep working after a brain is retired. Events show the sizes of inputs and outputs rather than the values; `get_execution` returns a run's result in full. A brain's own creation and retirement belong to its organization and are not among its events. A workflow run's history also shows, for each input the run took, the steps that moved and how they ended, and every event names the event that led to it. See [Run history and brain events](../reference/http.md#run-history-and-brain-events).

## Publishing events

A brain's history can also hold what happened elsewhere, such as a month closed in a ledger or a deal won in a CRM. `publish_event` records such an event in the brain, in the CloudEvents shape that many systems already send: where it comes from, what happened, and optionally what it is about, when it happened and its data. The event then appears in `list_brain_events` beside the definitions and runs the brain recorded.

An event is identified by its source and its id, and a brain keeps one event for each pair. Publishing the same event again records nothing and returns what was recorded the first time, so a sender can retry safely; a different event under the same source and id is refused. The brain's own facts, such as a run that finished or a definition that changed, use types and sources the brain keeps for itself, so a published event cannot pass for one. Starting a workflow when an event arrives is planned, as the event trigger in [Brain terminology](terminology.md#definitions-and-runs). See [Publishing events](../reference/http.md#publishing-events) for the attributes and limits.

## Dream

Coming soon.

Dream revisits recorded experience and explores associations that could suggest a different approach. It may surface a pattern worth investigating or propose a change to a method.

Those possibilities become Inspirations that the brain can consult while it works. A reasoning function can consider an inspiration and evaluate whether it makes sense for the current task. An association is a candidate idea, not automatically a fact or an improvement.

The intended behavior allows a brain to present its findings for review or apply changes within the authority it has been given. Dream is optional and is not implemented in this runtime yet. It belongs to the way functions and workflows work together, not a new function category or a claim that the runtime currently improves itself.
