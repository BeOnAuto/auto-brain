# History and Dream

A brain's history records saved definitions and what happened when they ran. After a campaign review, you can return to the definition version used, the rendered prompt and the result it produced. The current runtime stores run inputs in an event ledger; the run API exposes the recorded prompt and result, not the original input object.

For reason functions, recorded details also include model usage and the rendered prompt, subject to record-size limits. A new run does not automatically receive every earlier result as context; the required information must be supplied to the function.

Recorded history needs persistent storage and tested backups. Teams operating their own runtime should include both in their [self-hosting plan](../self-host.md). Event history can only preserve information recorded in it; external systems and unrecorded conversations are not retained automatically.

## Recall and projections

Recall retrieves or reconstructs relevant information. A projection derives a view or state from recorded events. The ledger is one possible source for a recall function, alongside other connected information.

Standalone recall definitions are planned. Today you can read a brain's recorded history in three ways, over HTTP and MCP:

- `list_executions` lists the runs of a brain, newest first, and can keep only the runs of one function or in one status.
- `get_execution_history` reads the history of one run: the facts recorded about it, from each start to how it ended, each with when it happened and a plain-language summary.
- `list_brain_events` follows everything recorded in a brain, such as definitions created, updated and retired and runs started and ended, and can keep one type of event or what was recorded since a time.

These reads page through long histories and keep working after a brain is retired. Events show the sizes of inputs and outputs rather than the values; `get_execution` returns a run's result in full. A brain's own creation and retirement belong to its organization and are not among its events. The individual steps of a workflow are not part of a run's history yet; they come with the updated workflow engine. See [Run history and brain events](../reference/http.md#run-history-and-brain-events).

## Dream

Coming soon.

Dream revisits recorded experience and explores associations that could suggest a different approach. It may surface a pattern worth investigating or propose a change to a method.

Those possibilities become Inspirations that the brain can consult while it works. A reason function can consider an inspiration and evaluate whether it makes sense for the current task. An association is a candidate idea, not automatically a fact or an improvement.

The intended behavior allows a brain to present its findings for review or apply changes within the authority it has been given. Dream is optional and is not implemented in this runtime yet. It belongs to the way functions and workflows work together, not a new function category or a claim that the runtime currently improves itself.
